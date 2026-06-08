export const dynamic = "force-dynamic";

import { ChevronRight, FileText, Plus } from "lucide-react";
import { createCampaign } from "@/app/actions/campaigns";
import { CampaignGrid } from "@/components/campaign-grid";
import { PageHeader } from "@/components/page-header";
import { getCampaignTemplates } from "@/lib/campaign-templates";
import { prisma } from "@/lib/prisma";
import { ageFromDate } from "@/lib/utils";
import { getActiveProject } from "@/projects";

export default async function CampaignCreatorPage() {
  let campaigns: { id: string; name: string; updatedAt: string; docCount: number }[] = [];
  let dbError = false;

  const project = await getActiveProject();
  try {
    const rows = await prisma.campaign.findMany({
      where: { archivedAt: null, projectSlug: project.slug },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { documents: true } } },
    });
    campaigns = rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: ageFromDate(row.updatedAt),
      docCount: row._count.documents,
    }));
  } catch {
    dbError = true;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Growth"
        title="Campaign Creator"
        description={
          <>
            <p>
              Workspace for drafting marketing campaigns end-to-end. Each campaign is a folder
              containing a brief and supporting documents.
            </p>
            <p className="mt-3 text-foreground-muted">
              <span className="mr-2 text-accent/90">╰┈➤</span>
              Create a new campaign, then open the folder to edit the brief and add more files.
            </p>
          </>
        }
        status="Workspace"
        actions={
          <form action={createCampaign}>
            <input type="hidden" name="name" value="Untitled campaign" />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-sm font-semibold text-accent hover:bg-lime-400/30"
            >
              <Plus className="h-4 w-4" />
              New campaign
            </button>
          </form>
        }
      />

      {dbError && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-3 text-sm text-amber-200">
          Database unreachable. Set DATABASE_URL in .env.local and run `npm run db:push`.
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            Start from a template
          </h2>
          <p className="text-[11px] text-foreground-subtle">
            Pre-filled briefs you can edit, then click <span className="text-accent">Generate everything from brief</span>.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {getCampaignTemplates(project).map((template) => (
            <form key={template.id} action={createCampaign}>
              <input type="hidden" name="templateId" value={template.id} />
              <button
                type="submit"
                className="group flex w-full flex-col items-start gap-2 rounded-xl border border-border bg-surface/70 p-4 text-left transition hover:border-accent-border hover:bg-accent-bg"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent-bg text-accent">
                    <FileText className="h-4 w-4" />
                  </span>
                  <ChevronRight className="h-4 w-4 text-foreground-subtle transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </div>
                <p className="text-sm font-semibold text-foreground">{template.label}</p>
                <p className="text-[12px] leading-snug text-foreground-muted">{template.tagline}</p>
              </button>
            </form>
          ))}
        </div>
      </section>

      <CampaignGrid campaigns={campaigns} />
    </div>
  );
}
