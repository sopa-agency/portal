import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchOnchainRevenueCached, type RealizedRevenue } from "@/lib/revenue-onchain";
import { getSplitConfig } from "@/lib/splits";
import { SOPA_SAFE } from "@/lib/superfluid";
import { attempt, type Reading } from "@/lib/reading";

// O mérito: quantos dólares cada pessoa trouxe para a SOPA, medidos.
//
// Isto NÃO mede nada de novo. A receita realizada já é lida e guardada por
// `fetchOnchainRevenueCached` (cache no banco, com TTL), e a fatia da SOPA em
// cada split sai do `getSplitConfig`. Recalcular aqui seria o quinto lugar do
// código a somar a mesma coisa de um jeito ligeiramente diferente — que é
// exatamente como o subtotal do swaps.pro passou a contar o mesmo dinheiro
// duas vezes. O que este arquivo acrescenta é só o RECORTE (a janela) e a
// DIVISÃO (entre quem foi creditado).

/** A janela. 90 dias: longa o bastante para um mês ruim não apagar ninguém,
 *  curta o bastante para a distribuição não congelar num contrato antigo. */
export const JANELA_DIAS = 90;

/** Quanto dos 100 pontos da cédula é mérito. O resto é a opinião de cada um. */
export const PONTOS_DE_MERITO = 30;

/**
 * O CHÃO: pontos que toda pessoa creditada recebe, mesmo sem valor medido.
 *
 * Sem ele o mérito trava. Quem foi creditado numa fonte que o portal ainda não
 * sabe precificar — um job manual, um leilão que não é split, uma venda de
 * droposal — ficava com ZERO, e zero por falta de medição é indistinguível de
 * zero por falta de trabalho. Era o pior dos dois mundos: castigava quem
 * contribuiu por uma limitação nossa.
 *
 * O chão é em PONTO, nunca em dólar. Inventar um valor em dólar contaminaria o
 * total medido e faria a tela afirmar receita que ninguém viu — exatamente o
 * que esta base recusa em todo lugar. Ponto é peso, e peso é o que a votação
 * distribui; dizer "esta pessoa contribuiu, ainda que eu não saiba quanto" é
 * uma afirmação verdadeira.
 */
export const PISO_PONTOS = 1;

export type FonteCreditada = {
  rotulo: string;
  tipo: "stream" | "job";
  creditados: string[];
  /** Dólares que ESTA fonte trouxe para a SOPA dentro da janela. */
  usd: number;
  /**
   * Por que o valor não pôde ser medido, quando não pôde.
   *
   * Fonte creditada e sem número não é fonte que rendeu zero: é fonte cujo
   * dinheiro ninguém contou. Somar as duas do mesmo jeito faria o mérito
   * castigar quem trouxe receita por um caminho que o portal ainda não lê.
   */
  semMedida?: string;
};

export type MeritoPessoa = {
  username: string;
  usd: number;
  /** True quando os pontos vêm só do chão — creditada, mas sem valor medido. */
  soChao: boolean;
  /** Fração do total medido, 0–1. */
  fracao: number;
  /** Pontos de mérito na cédula, já arredondados e somando PONTOS_DE_MERITO. */
  pontos: number;
  fontes: { rotulo: string; usd: number }[];
};

export type Merito = {
  pessoas: MeritoPessoa[];
  totalUsd: number;
  janelaDias: number;
  desde: string;
  /** Creditadas mas sem dólar medido — aparecem na tela em vez de sumir. */
  semMedida: FonteCreditada[];
};

/**
 * Quanto uma série CUMULATIVA rendeu dentro da janela.
 *
 * A série guardada é acumulada desde sempre, então o que aconteceu nos últimos
 * 90 dias é a diferença entre o fim dela e o último ponto ANTES da janela. Sem
 * nenhum ponto anterior, tudo o que existe aconteceu dentro da janela.
 */
function naJanela(r: RealizedRevenue, desde: Date): number {
  if (!r.series.length) return 0;
  const fim = r.series[r.series.length - 1].usd;
  let antes = 0;
  for (const p of r.series) {
    const t = new Date(p.t).getTime();
    if (Number.isNaN(t) || t >= desde.getTime()) break;
    antes = p.usd;
  }
  return Math.max(0, fim - antes);
}

const limpar = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter(Boolean))] : [];

/** As fontes creditadas: streams do org-chart + jobs da agência. */
async function fontesCreditadas(desde: Date): Promise<FonteCreditada[]> {
  const fontes: FonteCreditada[] = [];

  const boards = await prisma.sopaBoard.findMany({ where: { board: "orgchart" } }).catch(() => []);
  // Um contrato pode aparecer em DOIS streams (swaps.pro tem "Swaps fees" e
  // "Batch Send Fees" no mesmo split). Ler duas vezes contaria o mesmo dinheiro
  // duas vezes — a mesma armadilha que inflou o subtotal da receita.
  const porContrato = new Map<string, { rotulos: string[]; creditados: Set<string>; chain: string | null; address: string }>();
  const manuais: FonteCreditada[] = [];

  for (const b of boards) {
    const meta = b.meta && typeof b.meta === "object" && !Array.isArray(b.meta) ? (b.meta as Record<string, unknown>) : {};
    for (const s of Array.isArray(meta.revenueStreams) ? (meta.revenueStreams as Record<string, unknown>[]) : []) {
      const creditados = limpar(s?.credit);
      if (!creditados.length) continue;
      const rotulo = String(s?.label ?? "").trim() || "(sem nome)";
      const address = typeof s?.address === "string" ? s.address.trim() : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        manuais.push({
          rotulo,
          tipo: "stream",
          creditados,
          usd: 0,
          semMedida: "fonte manual: não tem contrato para ler, então o portal não sabe quanto ela trouxe",
        });
        continue;
      }
      const chain = typeof s?.chain === "string" && s.chain !== "all" ? s.chain : null;
      const k = `${chain ?? ""}:${address.toLowerCase()}`;
      const j = porContrato.get(k);
      if (j) {
        j.rotulos.push(rotulo);
        for (const c of creditados) j.creditados.add(c);
      } else {
        porContrato.set(k, { rotulos: [rotulo], creditados: new Set(creditados), chain, address });
      }
    }
  }

  await Promise.all(
    [...porContrato.values()].map(async (g) => {
      const [realizado, cfg] = await Promise.all([
        fetchOnchainRevenueCached(g.address, g.chain).catch(() => null),
        getSplitConfig(g.address, g.chain).catch(() => null),
      ]);
      const rotulo = g.rotulos.join(" + ");
      const creditados = [...g.creditados];
      // RESSALVA NÃO É FALHA. O campo `error` do leitor é sobrecarregado: ele
      // carrega tanto "não consegui ler" quanto "li, mas uma rede ficou de fora
      // e este total é um piso". Tratar os dois igual jogava fora número de
      // verdade — o swaps.pro leu a Base, tinha distribuição, e ainda assim
      // caía como não medido só porque veio com a ressalva de cobertura junto.
      //
      // A regra: se sobrou NÚMERO, ele conta. Piso é melhor que nada, e a
      // ressalva continua visível para quem quiser saber que é piso.
      if (!realizado) {
        fontes.push({ rotulo, tipo: "stream", creditados, usd: 0, semMedida: "a receita realizada não pôde ser lida" });
        return;
      }
      if (realizado.error && realizado.count === 0) {
        fontes.push({ rotulo, tipo: "stream", creditados, usd: 0, semMedida: realizado.error });
        return;
      }
      // A fatia da SOPA é lida do contrato, nunca suposta. Sem ela, o bruto do
      // split não diz quanto entrou AQUI — e mérito é o que entrou aqui.
      //
      // DUAS COISAS DIFERENTES, e antes as duas davam a mesma mensagem: não
      // conseguir LER a configuração é uma falha nossa; a SOPA não estar entre
      // os destinatários é um fato sobre o dinheiro. O leilão de NFT da Gnars
      // cai no segundo caso — ele traz receita de verdade, para o tesouro da
      // Gnars, e nada dele entra aqui.
      if (!cfg) {
        fontes.push({ rotulo, tipo: "stream", creditados, usd: 0, semMedida: "não consegui ler a configuração deste contrato" });
        return;
      }
      const fatia = cfg.recipients.find((r) => r.address.toLowerCase() === SOPA_SAFE.toLowerCase())?.share;
      if (fatia == null) {
        // Não é erro, e por isso o texto não pede desculpa: essa receita existe
        // e é trabalho de alguém — ela só não entra no caixa que esta votação
        // divide. Quem a trouxe é reconhecido nos pontos de opinião, que é onde
        // os colegas podem premiar o que o extrato da SOPA não mostra.
        fontes.push({
          rotulo,
          tipo: "stream",
          creditados,
          usd: 0,
          semMedida: "essa receita não entra no caixa da SOPA — vai para o tesouro do projeto",
        });
        return;
      }
      const usd = naJanela(realizado, desde) * fatia;
      // Leu, tem evento, mas nada caiu DENTRO da janela: isso é medição, não
      // falha — a fonte rendeu antes e não rende agora. Dizer isso é diferente
      // de dizer que não consegui ler.
      if (!(usd > 0)) {
        fontes.push({
          rotulo,
          tipo: "stream",
          creditados,
          usd: 0,
          semMedida: realizado.error ?? `sem distribuição nos últimos ${JANELA_DIAS} dias`,
        });
        return;
      }
      fontes.push({ rotulo, tipo: "stream", creditados, usd });
    }),
  );

  const jobs = await prisma.sopaJob.findMany({ where: { occurredOn: { gte: desde } } }).catch(() => []);
  for (const j of jobs) {
    const creditados = limpar(j.credit);
    if (!creditados.length) continue;
    // Job pendente ainda não é dinheiro que entrou. Contar promessa como
    // receita seria dar mérito por algo que pode não acontecer.
    if (j.status !== "paid") {
      fontes.push({ rotulo: j.client, tipo: "job", creditados, usd: 0, semMedida: "ainda não foi pago" });
      continue;
    }
    fontes.push({ rotulo: j.client, tipo: "job", creditados, usd: j.amountUsd });
  }

  return [...fontes, ...manuais];
}

/**
 * O mérito de cada pessoa na janela.
 *
 * Cada fonte é dividida POR IGUAL entre quem foi creditado nela — peso por
 * pessoa foi recusado de propósito: é o tipo de número que vira discussão sem
 * fim, e os pontos de opinião da cédula já existem para isso.
 */
export async function calcularMerito(janelaDias = JANELA_DIAS): Promise<Reading<Merito>> {
  return attempt(async () => {
    const desde = new Date(Date.now() - janelaDias * 86_400_000);
    const fontes = await fontesCreditadas(desde);

    const porPessoa = new Map<string, { usd: number; fontes: { rotulo: string; usd: number }[] }>();
    for (const f of fontes) {
      if (!(f.usd > 0) || !f.creditados.length) continue;
      const fatia = f.usd / f.creditados.length;
      for (const p of f.creditados) {
        const atual = porPessoa.get(p) ?? { usd: 0, fontes: [] };
        atual.usd += fatia;
        atual.fontes.push({ rotulo: f.rotulo, usd: fatia });
        porPessoa.set(p, atual);
      }
    }

    const totalUsd = [...porPessoa.values()].reduce((s, p) => s + p.usd, 0);

    // TODA pessoa creditada entra na lista, medida ou não. Quem só aparece em
    // fonte sem valor entra com US$ 0 e recebe o chão — é o que impede o peso
    // de travar em zero por limitação nossa.
    for (const f of fontes) {
      for (const p of f.creditados) if (!porPessoa.has(p)) porPessoa.set(p, { usd: 0, fontes: [] });
    }

    const linhas = [...porPessoa.entries()]
      .map(([username, v]) => ({ username, usd: v.usd, fontes: v.fontes.sort((a, b) => b.usd - a.usd) }))
      .sort((a, b) => b.usd - a.usd);

    // O chão sai primeiro, e o que sobra é repartido pelo que foi MEDIDO. Se os
    // chãos sozinhos já consomem o orçamento (muita gente creditada, pouco
    // ponto), todo mundo divide por igual — melhor um empate honesto que uma
    // proporção calculada sobre migalhas.
    const nPessoas = linhas.length;
    const orcamentoChao = nPessoas * PISO_PONTOS;
    const pisos: number[] = [];
    if (nPessoas === 0) {
      // nada a fazer
    } else if (orcamentoChao >= PONTOS_DE_MERITO) {
      const q = Math.floor(PONTOS_DE_MERITO / nPessoas);
      const sobra = PONTOS_DE_MERITO - q * nPessoas;
      linhas.forEach((_, i) => pisos.push(q + (i < sobra ? 1 : 0)));
    } else {
      const paraDistribuir = PONTOS_DE_MERITO - orcamentoChao;
      // Maior resto: arredondar cada um por conta própria faz a soma não fechar,
      // e aqui a soma é uma promessa — o mérito ocupa exatamente
      // PONTOS_DE_MERITO da cédula, nem um a mais.
      const exatos = linhas.map((l) => (totalUsd > 0 ? (l.usd / totalUsd) * paraDistribuir : 0));
      exatos.forEach((v) => pisos.push(Math.floor(v) + PISO_PONTOS));
      const resto = PONTOS_DE_MERITO - pisos.reduce((s, n) => s + n, 0);
      const ordem = exatos.map((v, i) => [v - Math.floor(v), i] as [number, number]).sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < resto && ordem.length; k++) pisos[ordem[k % ordem.length][1]]++;
    }

    return {
      pessoas: linhas.map((l, i) => ({
        username: l.username,
        usd: l.usd,
        soChao: !(l.usd > 0),
        fracao: totalUsd > 0 ? l.usd / totalUsd : 0,
        pontos: pisos[i],
        fontes: l.fontes,
      })),
      totalUsd,
      janelaDias,
      desde: desde.toISOString(),
      semMedida: fontes.filter((f) => f.semMedida),
    };
  }, (e) => `mérito não pôde ser calculado: ${e instanceof Error ? e.message : String(e)}`);
}
