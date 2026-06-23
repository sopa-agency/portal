export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { CuradoriaShell } from "@/components/curadoria-shell";
import { listTrailFeed } from "@/app/actions/farcaster-trail";

export default async function CuradoriaPage() {
  const feed = await listTrailFeed();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Engagement"
        title="Engagement"
        description="Curadoria e interação entre as redes — trail Farcaster/Hive, snaps da SkateHive e comentários do Instagram, tudo com aprovação humana (HITL)."
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
