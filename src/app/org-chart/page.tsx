import { notFound } from "next/navigation";
import { getActiveProject, getAllProjects } from "@/projects";
import { listBoard } from "@/app/actions/sopa-boards";
import { SopaOrgChart, type Person } from "@/components/sopa-org-chart";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const project = await getActiveProject();
  if (!project.orgChart || project.slug !== "sopa") notFound();
  const cards = await listBoard("orgchart");

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

  return <SopaOrgChart initial={cards} roster={roster} />;
}
