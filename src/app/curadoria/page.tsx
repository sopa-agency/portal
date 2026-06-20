export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { FarcasterTrailShell } from "@/components/farcaster-trail-shell";
import { listTrailFeed } from "@/app/actions/farcaster-trail";

export default async function CuradoriaPage() {
  const feed = await listTrailFeed();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Farcaster"
        title="Curadoria FC"
        description="Trail de curadoria entre nossas contas — like automático + reply HITL."
      />
      {feed.ok ? (
        <FarcasterTrailShell initial={feed.items} projectName={feed.project} />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-foreground-muted">
          {feed.error}
        </p>
      )}
    </div>
  );
}
