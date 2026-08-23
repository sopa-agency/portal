import { notFound } from "next/navigation";
import { getActiveProject, getAllProjects } from "@/projects";
import { listBoard } from "@/app/actions/sopa-boards";
import { type Person } from "@/components/sopa-org-chart";
import { OrgChartViews } from "@/components/org-chart-views";
import { getSopaRevenueOrbit, getSopaSupporters } from "@/lib/sopa-revenue-orbit";
import { getAddressBook } from "@/lib/address-book";
import { getBridgeFeeSummary } from "@/lib/bridge-fee-inflows";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const project = await getActiveProject();
  if (!project.orgChart || project.slug !== "sopa") notFound();
  const [cards, orbit, support] = await Promise.all([
    listBoard("orgchart"),
    getSopaRevenueOrbit().catch(() => ({ totalRealizedToSopaUsd: 0, totalPendingToSopaUsd: 0, totalEstimatedToSopaUsd: 0, grossTotalUsd: 0, projects: [] })),
    getSopaSupporters().catch(() => ({ vaultAddress: null, totalDepositedUsd: 0, totalEarnedUsd: 0, sopaEarnedUsd: 0, feeToSopa: 0, supporters: [] })),
  ]);

  // Roster = everyone across every project's team (allowlist), deduped. Hive
  // avatars + profile links come for free from the username.
  const seen = new Set<string>();
  const roster: Person[] = [];
  for (const p of getAllProjects()) {
    for (const u of p.allowlist) {
      const key = u.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      roster.push({
        username: u,
        avatarUrl: `https://images.hive.blog/u/${u}/avatar`,
        profileUrl: `${p.hive?.frontend ?? "https://peakd.com"}/@${u}`,
      });
    }
  }
  roster.sort((a, b) => a.username.localeCompare(b.username));

  const addressBook = await getAddressBook(cards).catch(() => []);
  const bridgeFee = getBridgeFeeSummary();

  return (
    <OrgChartViews
      cards={cards}
      roster={roster}
      orbit={orbit}
      support={support}
      addressBook={addressBook}
      bridgeFee={bridgeFee}
    />
  );
}
