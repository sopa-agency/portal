import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignFolderShell } from "@/components/campaign-folder-shell";
import { CampaignTitleEditor } from "@/components/campaign-title-editor";
import type { CampaignPreviewBrand } from "@/components/campaign-document-preview";
import { prisma } from "@/lib/prisma";
import { campaignProgress } from "@/lib/campaign-kind";
import { ageFromDate } from "@/lib/utils";
import { getActiveProject } from "@/projects";

export const dynamic = "force-dynamic";

export default async function CampaignFolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [project, campaign] = await Promise.all([
    getActiveProject(),
    prisma.campaign.findUnique({
      where: { id },
      include: {
        documents: { orderBy: [{ isMain: "desc" }, { updatedAt: "desc" }] },
      },
    }),
  ]);

  // 404 on missing OR cross-tenant access (campaign belongs to another project).
  // TODO: a freshly-created campaign can transiently 404 here due to Neon
  // read-after-write lag on the immediate redirect — add a short findUnique
  // retry (e.g. 2x ~300ms) before notFound() to smooth that over.
  if (!campaign || campaign.projectSlug !== project.slug) notFound();

  // Derive per-project brand for artifact previews.
  // handle: prefer the project's first social handle (strip leading @), else hive account.
  const primaryHandle = project.socials
    .find((s) => s.handle)
    ?.handle?.replace(/^@/, "");
  const brand: CampaignPreviewBrand = {
    avatarUrl: project.theme.logo,
    displayName: project.name,
    handle: primaryHandle ?? project.hive.account,
    hiveAccount: project.hive.account,
    hiveCommunity: project.hive.community,
    farcasterChannel: project.farcaster.channel,
    siteUrl: project.hive.frontend ?? "https://peakd.com",
    accent: project.theme.accentDark,
    accentDark: project.theme.accentLight,
  };

  const progress = campaignProgress(campaign.documents);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Link
          href="/campaign-creator"
          className="inline-flex items-center gap-1 text-xs text-foreground-subtle transition hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Campaign Creator</span>
        </Link>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-foreground-subtle">
          <span aria-hidden="true" className="inline-block h-1 w-6 rounded-full bg-gradient-to-r from-lime-400 to-emerald-400" />
          <span>Campaign folder</span>
        </div>
        <CampaignTitleEditor campaignId={campaign.id} initialName={campaign.name} />
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-foreground-subtle">
          <span>{campaign.documents.length} {campaign.documents.length === 1 ? "document" : "documents"}</span>
          <span aria-hidden="true">·</span>
          <span>Updated {ageFromDate(campaign.updatedAt)}</span>
          {progress.total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${progress.posted >= progress.total ? "bg-success/15 text-success" : "bg-foreground/10 text-foreground-muted"}`}>
                {progress.posted >= progress.total ? "✓ publicada" : "publicado"} {progress.posted}/{progress.total}
              </span>
            </>
          )}
        </div>
      </div>

      <CampaignFolderShell
        campaignId={campaign.id}
        documents={campaign.documents.map((doc) => ({
          id: doc.id,
          name: doc.name,
          content: doc.content,
          isMain: doc.isMain,
          updatedAt: doc.updatedAt,
          postedAt: doc.postedAt,
        }))}
        brand={brand}
      />
    </div>
  );
}
