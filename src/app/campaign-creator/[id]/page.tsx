import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignFolderShell } from "@/components/campaign-folder-shell";
import { CampaignTitleEditor } from "@/components/campaign-title-editor";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatAge(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default async function CampaignFolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      documents: { orderBy: [{ isMain: "desc" }, { updatedAt: "desc" }] },
    },
  });

  if (!campaign) notFound();

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
        <p className="text-[11px] text-foreground-subtle">
          {campaign.documents.length} {campaign.documents.length === 1 ? "document" : "documents"} ·
          Updated {formatAge(campaign.updatedAt)}
        </p>
      </div>

      <CampaignFolderShell
        campaignId={campaign.id}
        documents={campaign.documents.map((doc) => ({
          id: doc.id,
          name: doc.name,
          content: doc.content,
          isMain: doc.isMain,
          updatedAt: doc.updatedAt,
        }))}
      />
    </div>
  );
}
