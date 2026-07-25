import { notFound } from "next/navigation";
import { getActiveProject, getAllProjects } from "@/projects";
import { listBoard } from "@/app/actions/sopa-boards";
import { SopaPortfolio } from "@/components/sopa-portfolio";
import type { Person } from "@/components/sopa-org-chart";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const project = await getActiveProject();
  if (!project.portfolio || project.slug !== "sopa") notFound();
  const cards = await listBoard("portfolio");

  // Roster = everyone across every project's team (allowlist), deduped — same
  // source as the org-chart, so members can be related to each portfolio process.
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

  // Only expose the "publicar site" button when the deploy hook is configured;
  // the URL itself is a server secret and never crosses to the client.
  const canPublish = Boolean(process.env.SOPA_SITE_DEPLOY_HOOK_URL);

  return <SopaPortfolio initial={cards} roster={roster} canPublish={canPublish} />;
}
