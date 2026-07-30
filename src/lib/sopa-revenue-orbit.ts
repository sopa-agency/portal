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

// Provisional revenue wiring that isn't a readable 0xSplits split yet — shown so
// the money MAP is visible before the on-chain split exists or the allocation is
// decided. `sopaShare` here is a DECLARED number (off-chain agreement), NOT read
// from a contract; migrate each into a registered `split` stream once deployed.
type DeclaredInflow = {
  project: string;
  logoUrl: string | null;
  label: string;
  address: string;
  chain: string | null;
  sopaShare: number;
};

const DECLARED_INFLOWS: DeclaredInflow[] = [
  {
    // Morpheus "Gnars" builder subnet — opened 2026-07-29. Rewards split 80% SOPA
    // / 20% Gnars off-chain (Gnars destination still TBD). Not a 0xSplits contract
    // — the id is a bytes32 subnet, so the share can't be read on-chain; shown as
    // a wired flow at the agreed 80% until a real split is deployed & allocated.
    project: "Gnars",
    logoUrl: null,
    label: "MOR Builder Staking",
    address: "0xf129111951997d1c386be9b7de27d4c74490c42ad0ffbcb65e380d17f8a8ea3d",
    chain: "base",
    sopaShare: 0.8,
  },
];

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

  // Merge in declared (not-yet-on-chain) inflows as wired flows at $0 — attach to
  // the matching project when it already has a split, else stand it up on its own.
  for (const d of DECLARED_INFLOWS) {
    const flow: OrbitFlow = {
      key: `declared:${d.address}`,
      label: d.label,
      address: d.address,
      chain: d.chain,
      method: null,
      sopaShare: d.sopaShare,
      grossUsd: 0,
      realizedToSopaUsd: 0,
      splitBalanceUsd: 0,
      pendingToSopaUsd: 0,
    };
    const existing = projects.find((p) => p.name.toLowerCase() === d.project.toLowerCase());
    if (existing) {
      if (!existing.flows.some((f) => f.key === flow.key)) existing.flows.push(flow);
    } else {
      projects.push({ name: d.project, logoUrl: d.logoUrl, realizedToSopaUsd: 0, pendingToSopaUsd: 0, flows: [flow] });
    }
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
