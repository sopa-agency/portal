import "server-only";
import { prisma } from "@/lib/prisma";
import { zerionChart, type ChartPeriod } from "@/lib/zerion";
import { treasuryWallets } from "@/lib/treasury-wallet-snapshots";
import { getProject } from "@/projects";
import { attempt, insufficient, ok, type Reading } from "@/lib/reading";

// Série histórica de saldo por tesouro, a partir dos snapshots que o cron já
// grava de hora em hora (RevenueSnapshot). Nada aqui vai à rede: é leitura de
// banco, então somar tesouros ao gráfico não custa requisição nenhuma.

export type HistoryPoint = { t: string; usd: number };
export type TreasurySeries = { cardId: string; label: string; points: HistoryPoint[]; latestUsd: number };


/**
 * Fold a project's wallets into ONE line.
 *
 * A brand has one treasury; that it happens to be spread over a hot wallet and
 * two multisigs is custody, not accounting. Drawing a line per address turned
 * the brand page into a rainbow of series that nobody adds up by eye, and the
 * chart's own heading already claimed to show balance per TREASURY.
 *
 * Balances are steps, not samples: between two readings a wallet holds its last
 * value, it doesn't interpolate. So each wallet's last known value is carried
 * forward across the union of timestamps, and — for stamps before a wallet's
 * first reading — its first value is carried BACKWARD. Treating "no reading
 * yet" as zero would draw a ramp on the left edge that never happened.
 *
 * Projects stay apart. Folding ACROSS projects would hide whose money is whose,
 * which is the one thing the SOPA aggregator exists to keep straight.
 */
function foldIntoOne(list: TreasurySeries[], cardId: string, label: string): TreasurySeries[] {
  if (list.length === 0) return [];
  if (list.length === 1) return [{ ...list[0], cardId, label }];

  const stamps = [...new Set(list.flatMap((s) => s.points.map((p) => p.t)))].sort();
  const cursor = list.map(() => 0);
  const points = stamps.map((t) => {
    let usd = 0;
    list.forEach((s, i) => {
      while (cursor[i] + 1 < s.points.length && s.points[cursor[i] + 1].t <= t) cursor[i]++;
      usd += s.points[cursor[i]].usd;
    });
    return { t, usd };
  });
  return [{ cardId, label, points, latestUsd: points[points.length - 1].usd }];
}

/** One line per project, each the sum of that project's wallets. */
function foldByProject(tagged: { slug: string; series: TreasurySeries }[]): TreasurySeries[] {
  const groups = new Map<string, TreasurySeries[]>();
  for (const { slug, series } of tagged) {
    const list = groups.get(slug) ?? [];
    list.push(series);
    groups.set(slug, list);
  }
  return [...groups]
    .flatMap(([slug, list]) => foldIntoOne(list, slug, getProject(slug).name))
    .sort((a, b) => b.latestUsd - a.latestUsd);
}

/**
 * Uma série por card, com um ponto por DIA.
 *
 * Por dia, e não por snapshot: o cron grava de hora em hora, então 6 semanas
 * seriam ~1000 pontos por linha — ilegível no gráfico e caro de serializar pro
 * cliente. Do dia fica o ÚLTIMO ponto (o fechamento), não a média: a média de
 * um saldo que subiu degrau inventa valores que nunca existiram.
 *
 * Um card pode ter vários streams; os snapshots de todos somam no mesmo
 * instante para dar o saldo do tesouro naquele dia.
 */
export async function getTreasuryHistory(
  days = 60,
  /** Portal de marca vê só o próprio tesouro; a SOPA é a única agregadora
   *  intencional. Sem isto, abrir a Gnars mostraria o saldo da SkateHive. */
  only?: { name: string; slug: string },
): Promise<Reading<TreasurySeries[]>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const read = await attempt(
    () =>
      prisma.revenueSnapshot.findMany({
        where: { takenAt: { gte: since } },
        orderBy: { takenAt: "asc" },
        select: { cardId: true, address: true, totalUsd: true, takenAt: true },
      }),
    (e) => `histórico não leu: ${e instanceof Error ? e.message : String(e)}`,
  );
  if (read.state !== "ok") return read as Reading<TreasurySeries[]>;
  const rows = read.value;
  if (!rows.length) return insufficient("ainda não há pontos gravados no período");

  // Este catch FICA, e a diferença importa: ele degrada um RÓTULO, não um
  // número. Sem os títulos a série aparece com o id do card, que é feio e
  // visivelmente incompleto — não é um valor errado se passando por certo.
  const cards = await prisma.sopaBoard
    .findMany({ where: { id: { in: [...new Set(rows.map((r) => r.cardId))] } }, select: { id: true, title: true } })
    .catch(() => []);
  const titleById = new Map(cards.map((c) => [c.id, c.title]));

  // (card, dia) → (endereço → último saldo do dia). O último por ENDEREÇO antes
  // de somar: somar leituras de instantes diferentes misturaria um saldo velho
  // de um stream com o novo de outro.
  const byCardDay = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
    const day = r.takenAt.toISOString().slice(0, 10);
    const days_ = byCardDay.get(r.cardId) ?? new Map();
    const addrs = days_.get(day) ?? new Map<string, number>();
    addrs.set(r.address, r.totalUsd); // rows vêm ordenadas: a última sobrescreve
    days_.set(day, addrs);
    byCardDay.set(r.cardId, days_);
  }

  const out: TreasurySeries[] = [];
  for (const [cardId, days_] of byCardDay) {
    const points = [...days_.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, addrs]) => ({ t, usd: [...addrs.values()].reduce((s, v) => s + v, 0) }));
    if (points.length < 2) continue; // um ponto só não é série; não vira linha
    const label = titleById.get(cardId) ?? cardId;
    if (only) {
      const l = label.toLowerCase();
      if (l !== only.name.toLowerCase() && l !== only.slug.toLowerCase()) continue;
    }
    out.push({ cardId, label, points, latestUsd: points[points.length - 1].usd });
  }
  // Ordem estável por valor atual — mas a COR não vem daqui (ver o componente):
  // ela é fixada pelo cardId, senão trocar de faixa de datas repintaria tudo.
  // Lido com sucesso e sem série utilizável é "ainda não dá", não "não tem".
  if (!out.length) return insufficient("ainda não há série com dois pontos");
  return ok(out.sort((a, b) => b.latestUsd - a.latestUsd));
}

/**
 * Uma série por CARTEIRA de tesouro — a pergunta "quanto cada carteira tem ao
 * longo do tempo", que é diferente de "quanto cada card do org-chart arrecadou".
 * Sem essa separação o Safe da SOPA aparece dentro da linha da Gnars, porque lá
 * ele é um stream de MOR staking daquele card.
 */
export async function getTreasuryWalletHistory(
  days = 60,
  only?: { slug: string },
): Promise<Reading<TreasurySeries[]>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const read = await attempt(
    () =>
      prisma.treasuryWalletSnapshot.findMany({
      where: {
        takenAt: { gte: since },
        ...(only ? { projectSlug: only.slug } : {}),
        // Linhas de FALHA agora existem (totalUsd nulo) para poderem ser
        // contadas. Elas não são pontos: plotá-las como zero é exatamente o
        // despenhadeiro inventado que a coluna foi criada para evitar.
        totalUsd: { not: null },
        // Só EVM na série. As contas Hive passaram a ser fotografadas junto,
        // mas somá-las agora desenharia um degrau na linha no dia do corte —
        // uma subida que nunca aconteceu. Elas entram na medição de saúde; a
        // série ganha Hive quando houver histórico para ela desde o começo.
        kind: "evm",
        // UM leitor por série. Sem isto o gráfico pegaria a linha que chegou
        // por último a cada hora e a série alternaria entre dois leitores —
        // um degrau por hora, vindo do instrumento e não do tesouro.
        reader: "address",
      },
        orderBy: { takenAt: "asc" },
        select: { address: true, label: true, totalUsd: true, takenAt: true, projectSlug: true },
      }),
    (e) => `histórico de carteiras não leu: ${e instanceof Error ? e.message : String(e)}`,
  );
  if (read.state !== "ok") return read as Reading<TreasurySeries[]>;
  const rows = read.value;
  if (!rows.length) return insufficient("ainda não há fotos gravadas no período");

  // Bucket ADAPTATIVO. Por dia é o certo para 60 dias — mas nas primeiras horas
  // de vida da tabela todos os pontos caem no mesmo dia, colapsam em um só, e
  // `points.length < 2` descartaria a série inteira: gráfico vazio por um dia
  // depois de ligar a captura. Enquanto o histórico couber em menos de 3 dias,
  // agrupa por HORA, que é a granularidade real da captura.
  const span = new Set(rows.map((r) => r.takenAt.toISOString().slice(0, 10))).size;
  const bucket = (d: Date) => (span < 3 ? d.toISOString().slice(0, 13) + "h" : d.toISOString().slice(0, 10));

  const byWalletDay = new Map<string, { slug: string; label: string; days: Map<string, number> }>();
  for (const r of rows) {
    const e = byWalletDay.get(r.address) ?? { slug: r.projectSlug, label: r.label, days: new Map<string, number>() };
    e.days.set(bucket(r.takenAt), r.totalUsd!); // ordenado: o último do bucket vence
    byWalletDay.set(r.address, e);
  }

  const tagged: { slug: string; series: TreasurySeries }[] = [];
  for (const [address, e] of byWalletDay) {
    const points = [...e.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, usd]) => ({ t, usd }));
    if (points.length < 2) continue;
    tagged.push({
      slug: e.slug,
      series: { cardId: address, label: e.label, points, latestUsd: points[points.length - 1].usd },
    });
  }
  const folded = foldByProject(tagged);
  if (!folded.length) return insufficient("ainda não há série com dois pontos");
  return ok(folded);
}

/**
 * Histórico por carteira vindo DIRETO da Zerion.
 *
 * Preferido sobre o snapshot próprio para desenhar a linha: a Zerion devolve
 * meses de profundidade na primeira chamada, enquanto a nossa tabela leva
 * semanas para acumular o mesmo. O snapshot continua rodando como registro
 * independente e como rede de segurança se a cota estourar.
 *
 * Uma chamada por carteira, cacheada por período dentro do cliente Zerion.
 */
export async function getTreasuryWalletChart(
  period: ChartPeriod = "month",
  only?: { slug: string },
): Promise<{ series: TreasurySeries[]; failed: string[] }> {
  const wallets = treasuryWallets().filter((w) => !only || w.projectSlug === only.slug);
  const tagged: { slug: string; series: TreasurySeries }[] = [];
  const failed: string[] = [];

  const reads = await Promise.all(
    wallets.map(async (w) => ({ w, chart: await zerionChart(w.address, period).catch(() => ({ ok: false as const, error: "falhou" })) })),
  );

  for (const { w, chart } of reads) {
    // Carteira que não leu entra em `failed`, NÃO vira linha reta no zero.
    if (!chart.ok || chart.points.length < 2) {
      failed.push(w.label);
      continue;
    }
    const points = chart.points.map((p) => ({ t: new Date(p.t * 1000).toISOString(), usd: p.v }));
    tagged.push({
      slug: w.projectSlug,
      series: { cardId: w.address, label: w.label, points, latestUsd: points[points.length - 1].usd },
    });
  }
  // A wallet that failed to read is NOT folded in as zero — it stays named in
  // `failed`, which the chart prints, so a partial total announces itself
  // instead of quietly reading as a drop in the project's line.
  return { series: foldByProject(tagged), failed };
}

/** Uma carteira vista pelos DOIS leitores na mesma hora. */
export type ReaderDivergence = {
  label: string;
  address: string;
  /** fetchAddressBalance — Zerion primeiro, enxerga posição de protocolo. */
  addressUsd: number | null;
  /** fetchEvmWallet — fan-out de RPC, lê os extraTokens da config. */
  walletUsd: number | null;
  /** walletUsd − addressUsd. Positivo = a página vê MAIS que o snapshot. */
  deltaUsd: number | null;
  /** |delta| sobre o maior dos dois. Null quando algum lado não leu. */
  deltaPct: number | null;
  takenAt: Date;
};

/**
 * Quanto os dois leitores do tesouro discordam, na foto mais recente.
 *
 * Existe porque a métrica de saúde colhida por um leitor fala do caminho DELE:
 * enquanto a página lê por `fetchEvmWallet` e o snapshot por
 * `fetchAddressBalance`, um não mede o outro. Isto põe os dois lado a lado.
 *
 * Só o TOTAL é comparado, de propósito. Um diff por token exigiria uma chave de
 * identidade, e o que existe hoje em `EvmToken` é símbolo + chain — que é
 * exatamente a chave errada: dois contratos podem carregar o mesmo símbolo, e
 * casar por símbolo é como se publica um erro de ordem de grandeza. O diff por
 * token vem quando o token carregar o endereço do contrato.
 */
export async function getReaderDivergence(): Promise<Reading<ReaderDivergence[]>> {
  const read = await attempt(
    () =>
      prisma.treasuryWalletSnapshot.findMany({
        where: { kind: "evm", takenAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
        orderBy: { takenAt: "desc" },
        select: { address: true, label: true, totalUsd: true, reader: true, takenAt: true },
      }),
    (e) => `divergência não leu: ${e instanceof Error ? e.message : String(e)}`,
  );
  if (read.state !== "ok") return read as Reading<ReaderDivergence[]>;

  // A leitura MAIS RECENTE de cada (carteira, leitor). Comparar médias
  // esconderia justamente o caso em que um leitor falhou numa hora.
  const latest = new Map<string, (typeof read.value)[number]>();
  for (const r of read.value) {
    const key = `${r.address}:${r.reader}`;
    if (!latest.has(key)) latest.set(key, r); // ordenado desc: o primeiro é o mais novo
  }

  const out: ReaderDivergence[] = [];
  for (const [key, row] of latest) {
    if (!key.endsWith(":address")) continue;
    const pair = latest.get(`${row.address}:wallet`);
    const a = row.totalUsd;
    const w = pair?.totalUsd ?? null;
    const delta = a != null && w != null ? w - a : null;
    const biggest = a != null && w != null ? Math.max(Math.abs(a), Math.abs(w)) : 0;
    out.push({
      label: row.label,
      address: row.address,
      addressUsd: a,
      walletUsd: w,
      deltaUsd: delta,
      deltaPct: delta != null && biggest > 0 ? (Math.abs(delta) / biggest) * 100 : null,
      takenAt: row.takenAt,
    });
  }
  if (!out.length) return insufficient("os dois leitores ainda não coincidiram numa mesma hora");
  return ok(out.sort((x, y) => (y.deltaPct ?? -1) - (x.deltaPct ?? -1)));
}
