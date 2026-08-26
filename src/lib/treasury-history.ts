import "server-only";
import { prisma } from "@/lib/prisma";

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
