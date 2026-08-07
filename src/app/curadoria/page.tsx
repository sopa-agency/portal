export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { getDictionary } from "@/lib/i18n/server";
import { CuradoriaShell } from "@/components/curadoria-shell";
import { listTrailFeed } from "@/app/actions/farcaster-trail";

export default async function CuradoriaPage() {
  const feed = await listTrailFeed();
  const { engagement: t } = await getDictionary();

  return (
    <div className="space-y-6">
      {/* No eyebrow: it said "Engagement" directly above a title reading
          "Engagement". The description also lost its inventory of the tabs —
          the tabs are right there, and each one explains itself when opened. */}
      <PageHeader title={t.title} description={t.description} />
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
