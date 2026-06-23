export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { CuradoriaShell } from "@/components/curadoria-shell";
import { listTrailFeed } from "@/app/actions/farcaster-trail";

export default async function CuradoriaPage() {
  const feed = await listTrailFeed();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Curadoria"
        title="Curadoria"
        description="Trail entre nossas contas (Farcaster/Hive) + comentários do Instagram — tudo com reply HITL."
      />
      {feed.ok ? (
        <CuradoriaShell trail={feed.items} trailProject={feed.project} />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-foreground-muted">
          {feed.error}
        </p>
      )}
    </div>
  );
}
