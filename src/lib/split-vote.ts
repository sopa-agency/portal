import "server-only";

// A apuração da votação que decide as proporções do split.
//
// A REGRA CENTRAL: ninguém vota em si mesmo.
//
// Se pudesse, a estratégia dominante seria óbvia — todo mundo 100% em si. Não
// precisaria de má fé: bastaria uma pessoa fazer, e as outras nove passariam a
// ser trouxas se não fizessem. O sistema mediria autoavaliação, que é a única
// coisa que ele não deveria medir. Distribuindo pontos entre os OUTROS, a fatia
// de cada um é o que os pares reconheceram nele.
//
// A REGRA DA ABSTENÇÃO: quem não vota zera a própria voz E a própria fatia.
//
// É deliberadamente dura, e vale saber o que ela implica antes de doer: quem
// estiver doente ou viajando recebe zero naquela semana, e se só duas pessoas
// votarem, essas duas dividem tudo. Participar passa a ser parte do trabalho.
//
// O QUE ESTE MÓDULO NÃO FAZ: mover dinheiro. Ele produz o vetor; quem assina é
// o dono do split. Uma tela que reescreve o pagamento de dez pessoas sem
// assinatura seria uma tela com poder demais.

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSplitConfig } from "@/lib/splits";
import { carteirasConhecidas } from "@/lib/member-wallets";

export const TOTAL_PONTOS = 100;

/**
 * Quanto do PAGAMENTO vem do mérito medido (dólar trazido nos últimos 90 dias);
 * o resto vem dos votos. 30/70, o desenho original da cédula — que até
 * 19/09/2026 só existia como painel: a apuração pagava 100% pelos votos.
 *
 * O mérito só entra quando pôde ser MEDIDO e quando alguém do split tem dólar
 * medido; senão o pagamento fica inteiro nos votos e o resultado diz por quê.
 * Mérito de quem não está no split não tem como ser pago por este contrato,
 * então a fatia de mérito é repartida só entre os destinatários.
 */
export const PESO_MERITO = 0.3;

/**
 * A partir de quando o 70/30 vale. Rodadas abertas ANTES foram pagas 100% pelos
 * votos, e a apuração delas tem de continuar dizendo isso: recalcular o passado
 * com a regra nova faria a tela mostrar, como "a conta que gerou este peso",
 * números que nunca geraram peso nenhum.
 */
export const MERITO_VALE_DESDE = new Date("2026-09-19T00:00:00-03:00");

/** Dólar medido por pessoa (username em minúsculas), ou o motivo de não haver. */
export type MeritoParaApurar = { ok: true; usdPor: Record<string, number> } | { ok: false; motivo: string };

export type Elegivel = {
  address: string;
  /** Username do Team, quando o endereço está cadastrado lá. */
  username: string | null;
  /** Fatia atual no contrato, para comparar com o que a votação propõe. */
  shareAtual: number;
};

/**
 * Quem vota e quem recebe: os destinatários do split, lidos DA CADEIA.
 *
 * A fonte é o contrato, não uma lista nossa. Se alguém entrou ou saiu do split,
 * a urna acompanha sem ninguém precisar lembrar de atualizar uma tabela — e
 * uma lista paralela que sai de sincronia com o contrato é uma votação que
 * decide sobre gente que não recebe.
 */
export async function elegiveis(splitAddress: string, chain: string): Promise<Elegivel[] | null> {
  const cfg = await getSplitConfig(splitAddress, chain);
  if (!cfg) return null;
  // TODA carteira da pessoa, não só a do perfil: uma segunda carteira só
  // existia como login, e login não votava nem recebia crédito. Ver
  // member-wallets.ts.
  const { porEndereco } = await carteirasConhecidas();
  return cfg.recipients.map((r) => ({
    address: r.address,
    username: porEndereco.get(r.address.toLowerCase()) ?? null,
    shareAtual: r.share,
  }));
}

export type Cedula = { alvo: string; pontos: number };

/**
 * Valida uma cédula antes de gravar.
 *
 * Devolve o motivo em vez de um booleano: quem preencheu errado precisa saber o
 * quê, e "inválido" não é resposta para alguém que acabou de distribuir cem
 * pontos à mão.
 */
export function validarCedula(
  cedula: Cedula[],
  votante: string,
  elegiveisEnderecos: string[],
): { ok: true; limpa: Record<string, number> } | { ok: false; erro: string } {
  const validos = new Set(elegiveisEnderecos.map((a) => a.toLowerCase()));
  const eu = votante.toLowerCase();
  const limpa: Record<string, number> = {};
  let soma = 0;

  for (const { alvo, pontos } of cedula) {
    const a = alvo.trim().toLowerCase();
    if (!validos.has(a)) return { ok: false, erro: `${alvo} não está no split desta rodada.` };
    if (a === eu) return { ok: false, erro: "Você não pode distribuir pontos para si mesmo." };
    if (!Number.isFinite(pontos) || pontos < 0) return { ok: false, erro: "Pontos têm que ser zero ou mais." };
    if (!Number.isInteger(pontos)) return { ok: false, erro: "Use números inteiros." };
    if (pontos === 0) continue; // zero é ausência, não precisa ocupar linha
    limpa[a] = (limpa[a] ?? 0) + pontos;
    soma += pontos;
  }

  // Faltar e passar são erros diferentes e a mensagem tem que dizer qual — quem
  // acabou de distribuir cem pontos à mão não merece "faltam -10".
  if (soma < TOTAL_PONTOS) {
    return { ok: false, erro: `Faltam ${TOTAL_PONTOS - soma} pontos para fechar ${TOTAL_PONTOS}.` };
  }
  if (soma > TOTAL_PONTOS) {
    return { ok: false, erro: `Você distribuiu ${soma}: são ${soma - TOTAL_PONTOS} a mais que os ${TOTAL_PONTOS}.` };
  }
  return { ok: true, limpa };
}

export type Resultado = {
  /**
   * Proporções apuradas, em ordem decrescente. `share` é o que vai para o
   * contrato: (1 − pesoMerito) × shareVotos + pesoMerito × shareMerito.
   */
  linhas: { address: string; username: string | null; pontos: number; share: number; shareVotos: number; shareMerito: number; usdMerito: number; shareAtual: number }[];
  /** Quanto do pagamento veio do mérito NESTA apuração: PESO_MERITO ou 0. */
  pesoMerito: number;
  /** Por que o mérito não entrou, quando não entrou. */
  meritoMotivo: string | null;
  /** Cédulas sem autor, embaralhadas — o que torna a apuração conferível. */
  cedulasAnonimas: Record<string, number>[];
  votaram: number;
  elegiveis: number;
  /** Ainda não votou. NÃO é penalizado: só não tem cédula. */
  abstiveram: { address: string; username: string | null }[];
  /** Já votou — participação, não conteúdo. */
  quemVotou: { address: string; username: string | null }[];
  /**
   * NÃO PÔDE votar: está no split mas não tem carteira cadastrada no Team, então
   * a urna não consegue casar a pessoa com o endereço.
   *
   * Separado da abstenção de propósito. Zerar os dois do mesmo jeito seria punir
   * por um cadastro que falta com a mesma régua de quem decidiu não participar —
   * e a tela mostraria "absteve" para alguém que nunca teve a chance. É a mesma
   * distinção entre "não li" e "não houve" que vale no resto do portal, aqui
   * valendo uma fatia do pagamento.
   */
  semCadastro: { address: string }[];
};

/**
 * Embaralha de forma ESTÁVEL e não reversível pela ordem.
 *
 * Renderizar as cédulas na ordem de chegada vazaria o anonimato para quem sabe
 * quem votou primeiro. Ordenar por um hash do (rodada + votante) dá sempre a
 * mesma ordem — então a página não "pula" a cada carregamento — sem que essa
 * ordem diga nada sobre quem é quem.
 */
function ordemEstavel(roundId: string, voter: string): string {
  return crypto.createHash("sha256").update(`${roundId}:${voter}`).digest("hex");
}

export async function apurar(roundId: string, els: Elegivel[], merito: MeritoParaApurar | null = null): Promise<Resultado> {
  const cedulas = await prisma.splitVoteBallot.findMany({ where: { roundId } });
  const rodada = await prisma.splitVoteRound.findUnique({ where: { id: roundId }, select: { openedAt: true } }).catch(() => null);
  const regraNova = !rodada || rodada.openedAt.getTime() >= MERITO_VALE_DESDE.getTime();

  const pontosPor = new Map<string, number>();
  for (const el of els) pontosPor.set(el.address.toLowerCase(), 0);

  const votantes = new Set(cedulas.map((c) => c.voter.toLowerCase()));
  for (const c of cedulas) {
    const p = (c.points ?? {}) as Record<string, number>;
    for (const [addr, n] of Object.entries(p)) {
      const k = addr.toLowerCase();
      if (!pontosPor.has(k)) continue; // saiu do split entre o voto e a apuração
      pontosPor.set(k, (pontosPor.get(k) ?? 0) + Number(n || 0));
    }
  }

  // ABSTENÇÃO TIRA A VOZ, NÃO A FATIA.
  //
  // Antes este trecho zerava os pontos QUE OS OUTROS DERAM a quem não votou —
  // uma punição, e não foi isso que foi pedido. Quem não vota já perde o que
  // tinha a perder: a própria cédula não existe, então ele não influencia a
  // fatia de ninguém. Mas continua recebendo o que os colegas entenderam que
  // ele merece, porque o julgamento sobre o trabalho dele é DELES, não dele.
  //
  // O efeito prático da versão errada era brutal e apareceu no primeiro teste
  // real: com 5 de 10 votando, os outros 5 saíram com 0,0% — inclusive gente
  // que tinha recebido pontos de quase todo mundo. O resultado dizia "eles não
  // merecem nada" quando o que houve foi que eles não clicaram.
  const votouPorEndereco = new Set<string>();
  for (const el of els) {
    const u = el.username?.toLowerCase();
    if (u && votantes.has(u)) votouPorEndereco.add(el.address.toLowerCase());
  }

  const total = [...pontosPor.values()].reduce((s, n) => s + n, 0);

  // MÉRITO: dólar medido de cada destinatário, pelo username. Quem não tem
  // cadastro não tem como ter mérito casado; quem não está no split não entra.
  const usdDe = (e: Elegivel) => (regraNova && merito?.ok && e.username ? Math.max(0, merito.usdPor[e.username.toLowerCase()] ?? 0) : 0);
  const totalUsd = els.reduce((s, e) => s + usdDe(e), 0);
  let pesoMerito = 0;
  let meritoMotivo: string | null = null;
  if (!regraNova) meritoMotivo = "esta rodada é anterior à regra 70/30, que vale para rodadas abertas a partir de 19/09/2026";
  else if (!merito) meritoMotivo = "o mérito não foi informado à apuração";
  else if (!merito.ok) meritoMotivo = `o mérito não pôde ser medido (${merito.motivo})`;
  else if (!(totalUsd > 0)) meritoMotivo = "ninguém do split tem dólar medido na janela";
  else if (!(total > 0)) meritoMotivo = "ninguém votou ainda";
  else pesoMerito = PESO_MERITO;

  const linhas = els
    .map((e) => {
      const pontos = pontosPor.get(e.address.toLowerCase()) ?? 0;
      // Total zero (ninguém votou ainda) não vira NaN nem 100% para o
      // primeiro da lista: vira zero, que é a verdade daquele momento. E sem
      // voto nenhum o mérito sozinho NÃO define pagamento: uma folha decidida
      // com a urna vazia não é uma votação.
      const shareVotos = total > 0 ? pontos / total : 0;
      const usdMerito = usdDe(e);
      const shareMerito = totalUsd > 0 ? usdMerito / totalUsd : 0;
      return {
        address: e.address,
        username: e.username,
        pontos,
        share: total > 0 ? (1 - pesoMerito) * shareVotos + pesoMerito * shareMerito : 0,
        shareVotos,
        shareMerito,
        usdMerito,
        shareAtual: e.shareAtual,
      };
    })
    .sort((a, b) => b.share - a.share || b.pontos - a.pontos || (a.username ?? a.address).localeCompare(b.username ?? b.address));

  const cedulasAnonimas = [...cedulas]
    .sort((a, b) => ordemEstavel(roundId, a.voter).localeCompare(ordemEstavel(roundId, b.voter)))
    .map((c) => c.points as Record<string, number>);

  return {
    linhas,
    pesoMerito,
    meritoMotivo,
    cedulasAnonimas,
    votaram: cedulas.length,
    elegiveis: els.length,
    // Quem não votou. Continua listado — saber quem participou é o que permite
    // decidir a hora de fechar — mas agora sem prejuízo à fatia dele.
    abstiveram: els
      .filter((e) => e.username && !votouPorEndereco.has(e.address.toLowerCase()))
      .map((e) => ({ address: e.address, username: e.username })),
    /**
     * Quem JÁ votou, por nome.
     *
     * Revela participação, nunca conteúdo: as cédulas seguem sem autor e
     * embaralhadas. É o que faltava para decidir quando fechar a rodada —
     * antes só dava para ver "5 de 10", sem saber quais 5 ainda faltavam
     * cutucar.
     */
    quemVotou: els
      .filter((e) => e.username && votouPorEndereco.has(e.address.toLowerCase()))
      .map((e) => ({ address: e.address, username: e.username })),
    semCadastro: els.filter((e) => !e.username).map((e) => ({ address: e.address })),
  };
}

/**
 * O vetor pronto para `updateSplit`, em allocations inteiras.
 *
 * 0xSplits trabalha com inteiros sobre um totalAllocation, não com
 * porcentagens. Distribuir o resto do arredondamento para o maior evita que a
 * soma feche 999.999 e o contrato recuse — e o resto vai para quem tem mais
 * voto, que é a distorção menos arbitrária disponível.
 */
export function vetorParaContrato(
  linhas: { address: string; share: number }[],
  totalAllocation = 1_000_000,
): { recipients: string[]; allocations: number[]; totalAllocation: number } | null {
  const vivos = linhas.filter((l) => l.share > 0);
  if (vivos.length === 0) return null;
  const brutos = vivos.map((l) => Math.floor(l.share * totalAllocation));
  const resto = totalAllocation - brutos.reduce((s, n) => s + n, 0);
  let maior = 0;
  for (let i = 1; i < brutos.length; i++) if (brutos[i] > brutos[maior]) maior = i;
  brutos[maior] += resto;
  return { recipients: vivos.map((l) => l.address), allocations: brutos, totalAllocation };
}
