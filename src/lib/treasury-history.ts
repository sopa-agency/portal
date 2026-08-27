import "server-only";
import { prisma } from "@/lib/prisma";
import { zerionChart, type ChartPeriod } from "@/lib/zerion";
import { treasuryWallets } from "@/lib/treasury-wallet-snapshots";

// Série histórica de saldo por tesouro, a partir dos snapshots que o cron já
// grava de hora em hora (RevenueSnapshot). Nada aqui vai à rede: é leitura de
// banco, então somar tesouros ao gráfico não custa requisição nenhuma.

export type HistoryPoint = { t: string; usd: number };
export type TreasurySeries = { cardId: string; label: string; points: HistoryPoint[]; latestUsd: number };

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
): Promise<TreasurySeries[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.revenueSnapshot
    .findMany({ where: { takenAt: { gte: since } }, orderBy: { takenAt: "asc" }, select: { cardId: true, address: true, totalUsd: true, takenAt: true } })
    .catch(() => []);
  if (!rows.length) return [];

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
  return out.sort((a, b) => b.latestUsd - a.latestUsd);
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
): Promise<TreasurySeries[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.treasuryWalletSnapshot
    .findMany({
      where: { takenAt: { gte: since }, ...(only ? { projectSlug: only.slug } : {}) },
      orderBy: { takenAt: "asc" },
      select: { address: true, label: true, totalUsd: true, takenAt: true },
    })
    .catch(() => []);
  if (!rows.length) return [];

  // Bucket ADAPTATIVO. Por dia é o certo para 60 dias — mas nas primeiras horas
  // de vida da tabela todos os pontos caem no mesmo dia, colapsam em um só, e
  // `points.length < 2` descartaria a série inteira: gráfico vazio por um dia
  // depois de ligar a captura. Enquanto o histórico couber em menos de 3 dias,
  // agrupa por HORA, que é a granularidade real da captura.
  const span = new Set(rows.map((r) => r.takenAt.toISOString().slice(0, 10))).size;
  const bucket = (d: Date) => (span < 3 ? d.toISOString().slice(0, 13) + "h" : d.toISOString().slice(0, 10));

  const byWalletDay = new Map<string, { label: string; days: Map<string, number> }>();
  for (const r of rows) {
    const e = byWalletDay.get(r.address) ?? { label: r.label, days: new Map<string, number>() };
    e.days.set(bucket(r.takenAt), r.totalUsd); // ordenado: o último do bucket vence
    byWalletDay.set(r.address, e);
  }

  const out: TreasurySeries[] = [];
  for (const [address, e] of byWalletDay) {
    const points = [...e.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, usd]) => ({ t, usd }));
    if (points.length < 2) continue;
    out.push({ cardId: address, label: e.label, points, latestUsd: points[points.length - 1].usd });
  }
  return out.sort((a, b) => b.latestUsd - a.latestUsd);
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
  const series: TreasurySeries[] = [];
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
    series.push({ cardId: w.address, label: w.label, points, latestUsd: points[points.length - 1].usd });
  }
  return { series: series.sort((a, b) => b.latestUsd - a.latestUsd), failed };
}
