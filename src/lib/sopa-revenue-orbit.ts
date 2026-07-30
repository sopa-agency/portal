import "server-only";
import { getOrgRevenue } from "@/lib/org-revenue";
import { getSplitConfig } from "@/lib/splits";
import { SOPA_SAFE } from "@/lib/superfluid";

// Revenue flowing INTO the SOPA treasury, for the org-chart "Receita" view: every
// tracked split/swap where SOPA is a recipient, grouped by the project whose
// stream it is. The flow value is what actually LANDS in the SOPA Safe — the
// realized gross that passed the split, times SOPA's share read from the split
// contract itself (getSplitConfig.shareFor) — NOT the project's gross. Same data
// path the treasury's SopaRevenuePanel uses, just shaped for the flow diagram.

export type OrbitFlow = {
  key: string;
  /** The stream's label (e.g. the swap-split name). */
  label: string;
  address: string;
  chain: string | null;
  method: "auction" | "split";
  /** Gross that passed through the split. */
  grossUsd: number;
  /** SOPA's share of that split, 0–1. */
  sopaShare: number;
  /** grossUsd × sopaShare — what lands in the SOPA Safe. */
  toSopaUsd: number;
};

export type OrbitProject = {
  name: string;
  logoUrl: string | null;
  toSopaUsd: number;
  flows: OrbitFlow[];
};

export type SopaRevenueOrbit = {
  totalToSopaUsd: number;
  grossTotalUsd: number;
  projects: OrbitProject[];
};

export async function getSopaRevenueOrbit(): Promise<SopaRevenueOrbit> {
  const rev = await getOrgRevenue().catch(() => null);
  if (!rev) return { totalToSopaUsd: 0, grossTotalUsd: 0, projects: [] };

  const projects: OrbitProject[] = [];
  for (const p of rev.projects) {
    const splits = p.streams.filter((s) => s.kind === "split" && s.realized && s.realized.revenueUsd > 0);
    if (!splits.length) continue;

    const flows: OrbitFlow[] = [];
    for (const s of splits) {
      const cfg = await getSplitConfig(s.address, s.chain).catch(() => null);
      const share = cfg?.shareFor(SOPA_SAFE) ?? null;
      // Only draw a flow we can prove lands in the SOPA Safe.
      if (share == null || share <= 0) continue;
      const grossUsd = s.realized!.revenueUsd;
      flows.push({
        key: `${p.cardId}:${s.address}`,
        label: s.label,
        address: s.address,
        chain: s.chain,
        method: s.realized!.method === "auction" ? "auction" : "split",
        grossUsd,
        sopaShare: share,
        toSopaUsd: grossUsd * share,
      });
    }
    if (!flows.length) continue;
    projects.push({
      name: p.name,
      logoUrl: p.logoUrl,
      toSopaUsd: flows.reduce((a, f) => a + f.toSopaUsd, 0),
      flows,
    });
  }

  projects.sort((a, b) => b.toSopaUsd - a.toSopaUsd);
  return {
    totalToSopaUsd: projects.reduce((a, p) => a + p.toSopaUsd, 0),
    grossTotalUsd: projects.reduce((a, p) => a + p.flows.reduce((x, f) => x + f.grossUsd, 0), 0),
    projects,
  };
}
