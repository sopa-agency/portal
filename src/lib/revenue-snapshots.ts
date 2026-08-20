import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchAddressBalance } from "@/lib/treasury";

// Records the USD balance of every tracked revenue address (org-chart cards) so
// the UI can show the RATE revenue accrues, not just the current balance.
// Driven off the hourly Vercel cron, throttled to ~once/day.

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_EVERY_MS = 20 * 60 * 60 * 1000; // ~daily (some slack < 24h)

type TrackedTarget = { cardId: string; address: string; chain: string | null; label: string };

/** Every tracked (non-manual, has-address) revenue stream across all org-chart cards. */
async function collectTracked(): Promise<TrackedTarget[]> {
  const cards = await prisma.sopaBoard.findMany({ where: { board: "orgchart" }, select: { id: true, meta: true } });
  const out: TrackedTarget[] = [];
  for (const c of cards) {
    const meta = c.meta && typeof c.meta === "object" && !Array.isArray(c.meta) ? (c.meta as Record<string, unknown>) : {};
    const streams = Array.isArray(meta.revenueStreams) ? (meta.revenueStreams as Record<string, unknown>[]) : [];
    for (const s of streams) {
      const kind = typeof s.kind === "string" ? s.kind : "manual";
      const address = typeof s.address === "string" ? s.address.trim() : "";
      if (kind === "manual" || !/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
      out.push({
        cardId: c.id,
        address: address.toLowerCase(),
        chain: typeof s.chain === "string" && s.chain ? s.chain : null,
        label: typeof s.label === "string" ? s.label : "",
      });
    }
  }
  // Dedupe identical (card,address,chain).
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = `${t.cardId}:${t.chain ?? "all"}:${t.address}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Snapshot all tracked revenue balances — but only if the last snapshot is older
 * than ~a day (so the hourly cron effectively records one point/day). Safe to
 * call every tick. Never throws.
 */
export async function snapshotRevenueIfDue(now = Date.now()): Promise<{ ran: boolean; recorded?: number; reason?: string }> {
  try {
    const last = await prisma.revenueSnapshot.findFirst({ orderBy: { takenAt: "desc" }, select: { takenAt: true } });
    if (last && now - last.takenAt.getTime() < SNAPSHOT_EVERY_MS) {
      return { ran: false, reason: "not-due" };
    }
    const targets = await collectTracked();
    if (!targets.length) return { ran: false, reason: "no-tracked-addresses" };

    const takenAt = new Date(now);
    let recorded = 0;
    // Sequential-ish but small; a handful of addresses. Chunk to be gentle on RPCs.
    for (const t of targets) {
      const bal = await fetchAddressBalance(t.address, t.chain).catch(() => null);
      if (!bal) continue;
      await prisma.revenueSnapshot
        .create({ data: { cardId: t.cardId, address: t.address, chain: t.chain, label: t.label || null, totalUsd: bal.totalUsd, takenAt } })
        .then(() => { recorded++; })
        .catch(() => {});
    }
    return { ran: true, recorded };
  } catch (err) {
    return { ran: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export type RevenuePoint = { t: string; usd: number };
export type RevenueTrend = {
  key: string; // chain:address (matches the client balanceKey)
  points: RevenuePoint[];
  delta7d: number | null;
  delta30d: number | null;
};

/** Historical series + 7d/30d deltas per tracked address of a card. `currentUsd`
 *  (live, keyed by chain:address) lets the delta compare against the latest live
 *  value instead of the last stored snapshot. */
export async function getRevenueTrends(
  cardId: string,
  currentUsd: Record<string, number>,
  now = Date.now(),
): Promise<RevenueTrend[]> {
  const rows = await prisma.revenueSnapshot
    .findMany({ where: { cardId }, orderBy: { takenAt: "asc" }, select: { address: true, chain: true, totalUsd: true, takenAt: true } })
    .catch(() => []);
  const byKey = new Map<string, { t: number; usd: number }[]>();
  for (const r of rows) {
    const key = `${r.chain ?? "all"}:${r.address.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ t: r.takenAt.getTime(), usd: r.totalUsd });
  }
  const valueAt = (series: { t: number; usd: number }[], targetAgoMs: number): number | null => {
    const cutoff = now - targetAgoMs;
    // Closest snapshot at or before the cutoff; else the earliest we have.
    let pick: { t: number; usd: number } | null = null;
    for (const p of series) if (p.t <= cutoff) pick = p;
    return (pick ?? series[0] ?? null)?.usd ?? null;
  };
  const trends: RevenueTrend[] = [];
  for (const [key, series] of byKey) {
    const current = currentUsd[key];
    const cur = typeof current === "number" ? current : series[series.length - 1]?.usd ?? 0;
    const v7 = valueAt(series, 7 * DAY_MS);
    const v30 = valueAt(series, 30 * DAY_MS);
    trends.push({
      key,
      points: [...series.map((p) => ({ t: new Date(p.t).toISOString(), usd: p.usd })), { t: new Date(now).toISOString(), usd: cur }],
      delta7d: v7 == null ? null : cur - v7,
      delta30d: v30 == null ? null : cur - v30,
    });
  }
  return trends;
}
