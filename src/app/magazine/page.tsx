export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { getCuratorIssue, listCandidatePosts } from "@/app/actions/magazine";
import { MagazineCurator } from "@/components/magazine-curator";

export default async function MagazinePage() {
  const project = await getActiveProject();
  if (!project.magazine) notFound();

  const [issueRes, candRes] = await Promise.all([getCuratorIssue(), listCandidatePosts()]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={project.name}
        title="Magazine"
        description="Curadoria da revista — escolha e ordene os posts que aparecem no flipbook do site. Publique para servir a edição em /api/magazine/current."
      />
      {issueRes.ok ? (
        <MagazineCurator
          initialIssue={issueRes.issue}
          candidates={candRes.ok ? candRes.candidates : []}
          frontend={project.hive.frontend ?? "https://skatehive.app"}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-danger">{issueRes.error}</p>
      )}
    </div>
  );
}
