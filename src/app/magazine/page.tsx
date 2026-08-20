export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { listMagazineIssues, getCuratorIssue, listCandidatePosts } from "@/app/actions/magazine";
import { MagazineCurator } from "@/components/magazine-curator";

export default async function MagazinePage() {
  const project = await getActiveProject();
  if (!project.magazine) notFound();

  // Ensure a working draft exists first, then list all editions + candidates.
  const issueRes = await getCuratorIssue();
  const [listRes, candRes] = await Promise.all([listMagazineIssues(), listCandidatePosts()]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={project.name}
        title="Magazine"
        description="Curadoria da revista — edição atual, rascunhos e antigas. A edição publicada é servida em /api/magazine/current pro flipbook do site."
      />
      {issueRes.ok && listRes.ok ? (
        <MagazineCurator
          initialIssues={listRes.issues}
          initialActiveId={listRes.activeId}
          initialIssue={issueRes.issue}
          candidates={candRes.ok ? candRes.candidates : []}
          frontend={project.hive.frontend ?? "https://skatehive.app"}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-danger">
          {(!issueRes.ok && issueRes.error) || (!listRes.ok && listRes.error) || "Erro ao carregar."}
        </p>
      )}
    </div>
  );
}
