import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchAddressBalance } from "@/lib/treasury";
import {
  fetchOnchainRevenue,
  fetchAddressFlows,
  type RealizedRevenue,
  type RevenueFlow,
} from "@/lib/revenue-onchain";
import { getRevenueTrends, type RevenueTrend } from "@/lib/revenue-snapshots";

// Organization-wide revenue, aggregated from the tracked revenue streams on the
// SOPA org-chart cards (wallet / contract / split — the ones carrying a chain +
// 0x address). Same on-chain reads as the org-chart's Receita tab, but computed
// server-side and read-only for the treasury page. Balances + realized gross
// (AuctionSettled / SplitDistributed) + Δ7d/Δ30d trend per stream.

type Kind = "manual" | "wallet" | "contract" | "split";
type Token = { symbol: string; chain: string; balance: number; valueUsd: number | null };

export type OrgRevenueStream = {
  label: string;
  kind: Kind;
  chain: string | null;
  address: string;
  balanceUsd: number;
  tokens: Token[];
  /** Accurate event-based gross income (auction/split); null for plain wallets. */
  realized: RealizedRevenue | null;
  /** In/out flow proxy, used when there's no auction/split event history. */
  flow: RevenueFlow | null;
  trend: RevenueTrend | null;
  error?: string;
};

export type OrgRevenueProject = {
  cardId: string;
  name: string;
  logoUrl: string | null;
  streams: OrgRevenueStream[];
  balanceTotalUsd: number;
  realizedTotalUsd: number;
};

export type OrgRevenue = {
  projects: OrgRevenueProject[];
  balanceTotalUsd: number;
  realizedTotalUsd: number;
};

const keyOf = (chain: string | null, address: string) => `${chain ?? "all"}:${address.trim().toLowerCase()}`;
const KINDS: Kind[] = ["manual", "wallet", "contract", "split"];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * @param only  When set, keep only the org-chart card matching this project
 *   (by title ≈ name or slug) — so a brand portal's treasury shows just its own
 *   revenue. Omit for the SOPA org view (every tracked project, grouped).
 */
export async function getOrgRevenue(only?: { name: string; slug: string }): Promise<OrgRevenue> {
  const rows = await prisma.sopaBoard
    .findMany({ where: { board: "orgchart" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] })
    .catch(() => []);

  type Card = { cardId: string; name: string; logoUrl: string | null; streams: { label: string; kind: Kind; chain: string | null; address: string }[] };
  const cards: Card[] = [];
  for (const r of rows) {
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : {};
    const raw = Array.isArray(meta.revenueStreams) ? (meta.revenueStreams as unknown[]) : [];
    const streams = raw
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        label: String(s.label ?? "").trim(),
        kind: (KINDS.includes(String(s.kind) as Kind) ? String(s.kind) : "manual") as Kind,
        chain: s.chain == null || s.chain === "all" ? null : String(s.chain),
        address: typeof s.address === "string" ? s.address.trim() : "",
      }))
      .filter((s) => s.kind !== "manual" && /^0x[a-fA-F0-9]{40}$/.test(s.address));
    if (!streams.length) continue;
    if (only && norm(r.title) !== norm(only.name) && norm(r.title) !== norm(only.slug)) continue;
    cards.push({ cardId: r.id, name: r.title, logoUrl: typeof meta.logoUrl === "string" ? meta.logoUrl : null, streams });
  }
  if (!cards.length) return { projects: [], balanceTotalUsd: 0, realizedTotalUsd: 0 };

  // One on-chain read per unique (chain,address) across all cards.
  const uniq = new Map<string, { chain: string | null; address: string }>();
  for (const c of cards) for (const s of c.streams) uniq.set(keyOf(s.chain, s.address), { chain: s.chain, address: s.address });

  const bal = new Map<string, { totalUsd: number; tokens: Token[]; error?: string }>();
  const real = new Map<string, RealizedRevenue>();
  const flow = new Map<string, RevenueFlow>();
  await Promise.all(
    [...uniq.entries()].map(async ([k, t]) => {
      const [b, rr, fl] = await Promise.all([
        fetchAddressBalance(t.address, t.chain).catch((e) => ({ totalUsd: 0, tokens: [] as Token[], error: String(e) })),
        fetchOnchainRevenue(t.address, t.chain).catch(() => null),
        fetchAddressFlows(t.address, t.chain).catch(() => null),
      ]);
      bal.set(k, b);
      if (rr) real.set(k, rr);
      if (fl) flow.set(k, fl);
    }),
  );

  const projects: OrgRevenueProject[] = [];
  for (const c of cards) {
    const currentUsd: Record<string, number> = {};
    for (const s of c.streams) currentUsd[keyOf(s.chain, s.address)] = bal.get(keyOf(s.chain, s.address))?.totalUsd ?? 0;
    const trends = await getRevenueTrends(c.cardId, currentUsd).catch(() => [] as RevenueTrend[]);
    const trendByKey = new Map(trends.map((t) => [t.key, t]));

    let balanceTotalUsd = 0;
    let realizedTotalUsd = 0;
    const streams: OrgRevenueStream[] = c.streams.map((s) => {
      const k = keyOf(s.chain, s.address);
      const b = bal.get(k);
      const rr = real.get(k) ?? null;
      const useRealized = !!rr && rr.method !== "none" && rr.count > 0;
      balanceTotalUsd += b?.totalUsd ?? 0;
      if (useRealized && rr) realizedTotalUsd += rr.revenueUsd;
      return {
        label: s.label || (s.kind === "split" ? "Split" : "Fonte on-chain"),
        kind: s.kind,
        chain: s.chain,
        address: s.address,
        balanceUsd: b?.totalUsd ?? 0,
        tokens: b?.tokens ?? [],
        error: b?.error,
        realized: useRealized ? rr : null,
        flow: useRealized ? null : flow.get(k) ?? null,
        trend: trendByKey.get(k) ?? null,
      };
    });
    projects.push({ cardId: c.cardId, name: c.name, logoUrl: c.logoUrl, streams, balanceTotalUsd, realizedTotalUsd });
  }

  return {
    projects,
    balanceTotalUsd: projects.reduce((s, p) => s + p.balanceTotalUsd, 0),
    realizedTotalUsd: projects.reduce((s, p) => s + p.realizedTotalUsd, 0),
  };
}
