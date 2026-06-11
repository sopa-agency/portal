export const dynamic = "force-dynamic";

import { TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MorningBriefing, BriefingMissing } from "@/components/morning-briefing";
import { RegenerateBriefingButton } from "@/components/regenerate-briefing-button";
import { ChannelStrategy } from "@/components/social-dashboard";
import { HomeSplit, type SplitTab } from "@/components/home-split";
import { loadLatestBriefing, todayIsoDate } from "@/lib/morning-briefing";
import { fetchChannelMetrics } from "@/lib/social-metrics";
import { getActiveProject } from "@/projects";

// Direction B home (from the Claude Design handoff): summary band with the
// at-a-glance numbers up top, then Morning brief and Socials SIDE BY SIDE —
// no more top-level tab toggle hiding half the page.

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type BandTile = {
  label: string;
  value: string;
  delta?: number | null;
  sub?: string;
  tone?: "ok" | "warn";
};

function SummaryBand({ tiles }: { tiles: BandTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="flex overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
      {tiles.map((t, i) => (
        <div
          key={`${t.label}-${i}`}
          className={`flex min-w-[124px] flex-1 flex-col gap-1 px-4 py-3 ${
            i < tiles.length - 1 ? "border-r border-border" : ""
          }`}
        >
          <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-foreground-faint">
            {t.tone && (
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${t.tone === "ok" ? "bg-success" : "bg-warning"}`}
                aria-hidden
              />
            )}
            <span className="whitespace-nowrap">{t.label}</span>
          </span>
          <span className="text-[22px] font-extrabold leading-none tracking-tight text-foreground">
            {t.value}
          </span>
          {t.delta != null && t.delta !== 0 ? (
            <span
              className={`flex items-center gap-1 text-[11px] font-semibold ${
                t.delta > 0 ? "text-success" : "text-danger"
              }`}
            >
              {t.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {t.delta > 0 ? "+" : ""}
              {formatNumber(t.delta)} · 7d
            </span>
          ) : (
            <span className="text-[11px] text-foreground-faint">{t.sub ?? "—"}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function Home() {
  const today = todayIsoDate();
  const project = await getActiveProject();
  const briefingAgents = project.briefingAgents;

  const [briefResults, channelMetrics] = await Promise.all([
    Promise.all(briefingAgents.map((a) => loadLatestBriefing(a))),
    Promise.all(
      project.socials.map((s) =>
        fetchChannelMetrics(s.platform, s.metricsAccount ?? s.handle?.replace(/^@/, ""), project).catch(
          () => null,
        ),
      ),
    ),
  ]);

  // --- left pane: one tab per briefing agent (DEV / MKT / …) ---------------
  const briefTabs: SplitTab[] = [];
  let freshBriefs = 0;
  for (const agent of briefingAgents) {
    const result = briefResults.find((r) => (r.ok ? r.briefing.agent.slug : r.agent.slug) === agent.slug);
    if (!result) continue;
    if (result.ok && result.briefing.date === today) freshBriefs++;
    briefTabs.push({
      slug: agent.slug,
      label: agent.tabLabel ?? agent.label,
      content: result.ok ? (
        <MorningBriefing
          briefing={result.briefing}
          today={today}
          teamEmails={project.teamEmails ?? []}
          projectName={project.name}
          githubRepo={project.repos[0]}
        />
      ) : (
        <BriefingMissing agent={result.agent} error={result.error} />
      ),
    });
  }

  // --- right pane: one tab per social channel ------------------------------
  const channelTabs: SplitTab[] = project.socials.map((channel) => ({
    slug: channel.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: channel.platform,
    content: <ChannelStrategy channel={channel} agentName={project.agent.displayName} />,
  }));

  // --- summary band: real at-a-glance numbers ------------------------------
  const tiles: BandTile[] = [
    {
      label: "Briefings",
      value: `${freshBriefs}/${briefTabs.length || briefingAgents.length}`,
      sub: freshBriefs === briefTabs.length && briefTabs.length > 0 ? "fresh today" : "stale — regenerate",
      tone: freshBriefs === briefTabs.length && briefTabs.length > 0 ? "ok" : "warn",
    },
    ...project.socials.map((s, i): BandTile => {
      const m = channelMetrics[i];
      if (m && m.ok && m.followers != null) {
        return { label: s.platform, value: formatNumber(m.followers), delta: m.followersDelta7d };
      }
      return {
        label: s.platform,
        value: "—",
        sub: m && !m.ok && m.reason === "not-connected" ? "not connected" : "no data",
      };
    }),
  ];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Daily · ${today}`}
        title={project.name}
        description={project.description}
        actions={<RegenerateBriefingButton />}
      />

      <SummaryBand tiles={tiles} />

      <HomeSplit briefTabs={briefTabs} channelTabs={channelTabs} />
    </div>
  );
}
