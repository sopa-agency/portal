export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { getHomepageDraft, listHomepageVersions } from "@/app/actions/homepage";
import { HomepageComposer } from "@/components/homepage-composer";

export default async function HomepagePage() {
  const project = await getActiveProject();
  if (!project.homepage) notFound();

  // Ensure a working draft exists (seeded from live), then list all versions.
  const draftRes = await getHomepageDraft();
  const listRes = await listHomepageVersions();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={project.name}
        title="Homepage"
        description="Curadoria da home-revista. Rascunho → preview → publicar. A versão publicada é servida em /api/homepage/current pra rota /home do site."
      />
      {draftRes.ok && listRes.ok ? (
        <HomepageComposer
          initialConfig={draftRes.config}
          initialMeta={draftRes.meta}
          versions={listRes.versions}
          activeId={listRes.activeId}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-danger">
          {(!draftRes.ok && draftRes.error) || (!listRes.ok && listRes.error) || "Erro ao carregar."}
        </p>
      )}
    </div>
  );
}
