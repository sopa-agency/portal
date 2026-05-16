export const dynamic = "force-dynamic";

import { Plus } from "lucide-react";
import { createCampaign } from "@/app/actions/campaigns";
import { CampaignGrid } from "@/components/campaign-grid";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";

function formatAge(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default async function CampaignCreatorPage() {
  let campaigns: { id: string; name: string; updatedAt: string; docCount: number }[] = [];
  let dbError = false;

  try {
    const rows = await prisma.campaign.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { documents: true } } },
    });
    campaigns = rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: formatAge(row.updatedAt),
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

      <CampaignGrid campaigns={campaigns} />
    </div>
  );
}
