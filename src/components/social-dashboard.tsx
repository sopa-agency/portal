import { ExternalLink } from "lucide-react";
import type { SocialChannel } from "@/projects/types";
import { BriefingTabs, type BriefingTab } from "@/components/briefing-tabs";
import { ChannelMetrics } from "@/components/channel-metrics";
import { SocialInsights } from "@/components/social-insights";

// Home "Socials" dashboard: one subtab per channel the active project runs,
// each showing that channel's posting strategy. Rendered inside the top-level
// Socials tab on the home page.
export function SocialDashboard({
  socials,
  agentName,
}: {
  socials: SocialChannel[];
  agentName?: string;
}) {
  if (socials.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface-elevated p-8 text-center text-sm text-foreground-subtle">
        No social channels configured for this project yet.
      </div>
    );
  }

  const tabs: BriefingTab[] = socials.map((channel) => ({
    slug: channel.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: channel.platform,
    content: <ChannelStrategy channel={channel} agentName={agentName} />,
  }));

  return <BriefingTabs tabs={tabs} paramKey="channel" />;
}

export function ChannelStrategy({
  channel,
  agentName,
}: {
  channel: SocialChannel;
  agentName?: string;
}) {
  return (
    <div className="space-y-6">
      {/* Live metrics — loads async from /api/socials/metrics */}
      <ChannelMetrics platform={channel.platform} />

      {/* AI insights — the project agent reads the metrics and suggests moves */}
      <SocialInsights platform={channel.platform} agentName={agentName} />

      <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">{channel.platform}</h3>
            {channel.handle && (
              <span className="rounded-full bg-accent-bg px-2 py-0.5 text-xs font-medium text-accent">
                {channel.handle}
              </span>
            )}
          </div>
          {channel.note && (
            <p className="mt-1 text-xs text-foreground-subtle">{channel.note}</p>
          )}
        </div>
        {channel.url && (
          <a
            href={channel.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition hover:bg-foreground/5 hover:text-foreground"
          >
            Open <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>
    </div>
  );
}
