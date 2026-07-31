import "server-only";
import { getOrgRevenue } from "@/lib/org-revenue";
import { getSplitConfig } from "@/lib/splits";
import { getMorBuilderReward } from "@/lib/mor-builder";
import { getCommunityVaults } from "@/lib/community-vaults";
import { getVaultDepositors } from "@/lib/vault-depositors";
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
  /** Share is a DECLARED off-chain number (not a 0xSplits read) — shown for the map. */
  declared?: boolean;
  /** Declared flows only: an ESTIMATED $ into SOPA (e.g. MOR builder reward × share),
   *  priced off-chain. Kept OUT of realized/pending totals — those stay provable. */
  estimatedToSopaUsd?: number;
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
  /** Sum of declared flows' estimated $ (MOR reward etc.) — off-chain estimate. */
  totalEstimatedToSopaUsd: number;
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
  /** When set, read this Morpheus builder pool's current MOR reward and estimate SOPA's cut in $. */
  morPoolId?: string;
};

const DECLARED_INFLOWS: DeclaredInflow[] = [
  {
    // Morpheus "Gnars" builder subnet — opened 2026-07-29. Rewards split 80% SOPA
    // / 20% Gnars off-chain (Gnars destination still TBD). Not a 0xSplits contract
    // — the id is a bytes32 subnet, so the share can't be read on-chain; shown as
    // a declared flow at the agreed 80% until a real split is deployed & allocated.
    project: "Gnars",
    logoUrl: null,
    label: "MOR Builder Staking",
    address: "0xf129111951997d1c386be9b7de27d4c74490c42ad0ffbcb65e380d17f8a8ea3d",
    chain: "base",
    sopaShare: 0.8,
    morPoolId: "0xf129111951997d1c386be9b7de27d4c74490c42ad0ffbcb65e380d17f8a8ea3d",
  },
  {
    // SwapPro cross-chain (THORChain affiliate) — LIVE. Multi-affiliate memo
    // `keep/thor1ujdj…:24/6` pays the KeepKey THORName 24 bps + SOPA 6 bps → SOPA
    // gets 6/30 = 20% of the 0.30% fee. It's on THORChain (THORName, not EVM), so
    // there's no 0xSplits to read — declared at 20%. Realized $ = a Midgard follow-up.
    project: "swaps.pro",
    logoUrl: null,
    label: "THORChain affiliate (cross-chain)",
    address: "thor1ujdj4360n835r49yzuvvsyu80hv28k9frlqeuh",
    chain: "thorchain",
    sopaShare: 0.2,
  },
];

export async function getSopaRevenueOrbit(): Promise<SopaRevenueOrbit> {
  const empty: SopaRevenueOrbit = { totalRealizedToSopaUsd: 0, totalPendingToSopaUsd: 0, totalEstimatedToSopaUsd: 0, grossTotalUsd: 0, projects: [] };
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
    // For a MOR builder pool, read the current on-chain reward and estimate SOPA's
    // cut (reverts → 0 while the pool is fresh, so this stays $0 until it accrues).
    let estimatedToSopaUsd: number | undefined;
    if (d.morPoolId) {
      const r = await getMorBuilderReward(d.morPoolId).catch(() => null);
      if (r && r.rewardUsd > 0) estimatedToSopaUsd = r.rewardUsd * d.sopaShare;
    }
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
      declared: true,
      estimatedToSopaUsd,
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
    totalEstimatedToSopaUsd: projects.reduce((a, p) => a + p.flows.reduce((x, f) => x + (f.estimatedToSopaUsd ?? 0), 0), 0),
    grossTotalUsd: projects.reduce((a, p) => a + p.flows.reduce((x, f) => x + f.grossUsd, 0), 0),
    projects,
  };
}

// The OTHER side of the orbit: people BACKING the SOPA treasury by staking into
// the community support vault ("Apoiar"). Their deposits earn Moonwell yield and
// a share of that yield (feeToSopa) flows to the SOPA Safe — so each backer is a
// support inflow, mirroring the revenue inflows.

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export type OrbitSupporter = {
  key: string;
  /** Member name (Hive username) when known, else a shortened address. */
  label: string;
  address: string;
  /** Hive PFP when the backer is a known member; null → initials fallback. */
  avatarUrl: string | null;
  /** Redeemable USDC in the vault right now (principal + yield). */
  amountUsd: number;
  /** Yield earned so far. */
  earnedUsd: number;
};

export type SopaSupport = {
  vaultAddress: string | null;
  totalDepositedUsd: number;
  /** Share of vault yield routed to the SOPA Safe (0–1). */
  feeToSopa: number;
  supporters: OrbitSupporter[];
};

export async function getSopaSupporters(): Promise<SopaSupport> {
  const empty: SopaSupport = { vaultAddress: null, totalDepositedUsd: 0, feeToSopa: 0, supporters: [] };
  const vaults = await getCommunityVaults().catch(() => []);
  const sopaVault = vaults.find((v) => v.paysSopa) ?? null;
  if (!sopaVault) return empty;

  const depositors = await getVaultDepositors(sopaVault.vault.address).catch(() => []);
  const backers = depositors
    .filter((d) => !d.isDeadDeposit && d.assets > 0)
    .sort((a, b) => b.assets - a.assets);

  const supporters: OrbitSupporter[] = backers.map((d) => ({
    key: d.address,
    label: d.label ?? shortAddr(d.address),
    address: d.address,
    avatarUrl: d.label ? `https://images.hive.blog/u/${d.label}/avatar` : null,
    amountUsd: d.assets,
    earnedUsd: d.earned,
  }));

  return {
    vaultAddress: sopaVault.vault.address,
    totalDepositedUsd: backers.reduce((s, d) => s + d.assets, 0),
    feeToSopa: sopaVault.fee,
    supporters,
  };
}
