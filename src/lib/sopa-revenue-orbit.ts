import "server-only";
import { getOrgRevenue } from "@/lib/org-revenue";
import { getSplitConfig } from "@/lib/splits";
import { SOPA_SAFE } from "@/lib/superfluid";

// Revenue wiring INTO the SOPA treasury, for the org-chart "Revenue" view: EVERY
// registered split/swap where SOPA is a recipient — the share is read from the
// split's own SplitUpdated config, so a split shows up as soon as it's wired,
// even before any revenue is realized. Per split we surface both:
//   - realized: gross that already passed the split × SOPA's share (distributed).
//   - pending:  what's sitting in the split contract RIGHT NOW × SOPA's share
//     (waiting for the next distribute() to push it to the Safe).
// So the orbit shows the money MAP immediately, and fills in $ as revenue flows.

export type OrbitFlow = {
  key: string;
  /** The stream's label (e.g. the swap-split name). */
  label: string;
  address: string;
  chain: string | null;
  /** null until an auction/split revenue event is indexed. */
  method: "auction" | "split" | null;
  /** SOPA's share of this split, 0–1 (read from the split contract). */
  sopaShare: number;
  /** Gross that already passed the split (realized events); 0 if none yet. */
  grossUsd: number;
  /** grossUsd × sopaShare — already distributed to the Safe. */
  realizedToSopaUsd: number;
  /** What's sitting in the split contract now. */
  splitBalanceUsd: number;
  /** splitBalanceUsd × sopaShare — SOPA's cut waiting for the next distribute(). */
  pendingToSopaUsd: number;
};

export type OrbitProject = {
  name: string;
  logoUrl: string | null;
  realizedToSopaUsd: number;
  pendingToSopaUsd: number;
  flows: OrbitFlow[];
};

export type SopaRevenueOrbit = {
  totalRealizedToSopaUsd: number;
  totalPendingToSopaUsd: number;
  grossTotalUsd: number;
  projects: OrbitProject[];
};

export async function getSopaRevenueOrbit(): Promise<SopaRevenueOrbit> {
  const empty: SopaRevenueOrbit = { totalRealizedToSopaUsd: 0, totalPendingToSopaUsd: 0, grossTotalUsd: 0, projects: [] };
  const rev = await getOrgRevenue().catch(() => null);
  if (!rev) return empty;

  const projects: OrbitProject[] = [];
  for (const p of rev.projects) {
    // EVERY registered split, not only ones with realized revenue — the wiring
    // (project → SOPA at X%) is worth showing before the first distribution.
    const splits = p.streams.filter((s) => s.kind === "split");
    if (!splits.length) continue;

    const flows: OrbitFlow[] = [];
    for (const s of splits) {
      const cfg = await getSplitConfig(s.address, s.chain).catch(() => null);
      const share = cfg?.shareFor(SOPA_SAFE) ?? null;
      // Only draw a split we can prove pays SOPA (share read from the contract).
      if (share == null || share <= 0) continue;
      const grossUsd = s.realized?.revenueUsd ?? 0;
      const splitBalanceUsd = s.balanceUsd ?? 0;
      flows.push({
        key: `${p.cardId}:${s.address}`,
        label: s.label,
        address: s.address,
        chain: s.chain,
        method: s.realized ? (s.realized.method === "auction" ? "auction" : "split") : null,
        sopaShare: share,
        grossUsd,
        realizedToSopaUsd: grossUsd * share,
        splitBalanceUsd,
        pendingToSopaUsd: splitBalanceUsd * share,
      });
    }
    if (!flows.length) continue;
    projects.push({
      name: p.name,
      logoUrl: p.logoUrl,
      realizedToSopaUsd: flows.reduce((a, f) => a + f.realizedToSopaUsd, 0),
      pendingToSopaUsd: flows.reduce((a, f) => a + f.pendingToSopaUsd, 0),
      flows,
    });
  }

  // Most SOPA-relevant first (realized + pending).
  projects.sort((a, b) => b.realizedToSopaUsd + b.pendingToSopaUsd - (a.realizedToSopaUsd + a.pendingToSopaUsd));
  return {
    totalRealizedToSopaUsd: projects.reduce((a, p) => a + p.realizedToSopaUsd, 0),
    totalPendingToSopaUsd: projects.reduce((a, p) => a + p.pendingToSopaUsd, 0),
    grossTotalUsd: projects.reduce((a, p) => a + p.flows.reduce((x, f) => x + f.grossUsd, 0), 0),
    projects,
  };
}
