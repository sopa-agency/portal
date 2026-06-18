export const dynamic = "force-dynamic";
// Briefing regeneration runs as a Server Action from this route and calls the
// agent gateway (minutes). Without this the function is killed at the default
// ~60s → 504 gateway timeout. Fluid Compute allows up to 300s.
export const maxDuration = 300;

import { redirect } from "next/navigation";
import { TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { MorningBriefing, BriefingMissing } from "@/components/morning-briefing";
import { RegenerateBriefingButton } from "@/components/regenerate-briefing-button";
import { ChannelStrategy } from "@/components/social-dashboard";
import { HomeSplit, type SplitTab } from "@/components/home-split";
import { loadLatestBriefing, todayIsoDate } from "@/lib/morning-briefing";
import { fetchChannelMetrics } from "@/lib/social-metrics";
import { getActiveProject } from "@/projects";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getTeamRoster } from "@/lib/team-roster";
import { getMemberTasks, type MemberTask } from "@/app/actions/team-admin";
import { MyTasks } from "@/components/my-tasks";

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
  /** Social platform name — renders the brand mark next to the label. */
  platform?: string;
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
            {t.platform && <SocialBrandIcon platform={t.platform} className="h-3 w-3 shrink-0" />}
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
  const project = await getActiveProject();
  // Portals that hide "/" (SOPA) land on their first real page: the About deck
  // when enabled, otherwise the treasury.
  if (project.hiddenRoutes?.includes("/")) redirect(project.about ? "/about" : "/treasury");
  const today = todayIsoDate();
  const briefingAgents = project.briefingAgents;
  // Instagram leads the socials pane (and the band) — it's the primary channel.
  const socials = [...project.socials].sort((a, b) => {
    const ig = (p: string) => (p.toLowerCase() === "instagram" ? 0 : 1);
    return ig(a.platform) - ig(b.platform);
  });

  const [briefResults, channelMetrics] = await Promise.all([
    Promise.all(briefingAgents.map((a) => loadLatestBriefing(a))),
    Promise.all(
      socials.map((s) =>
        fetchChannelMetrics(s.platform, s.metricsAccount ?? s.handle?.replace(/^@/, ""), project).catch(
          () => null,
        ),
      ),
    ),
  ]);

  // Logged-in user's own Kanban tasks (shown below the briefing).
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  let myTasks: MemberTask[] = [];
  let myEmail: string | null = null;
  if (session && project.githubProject) {
    const me = (await getTeamRoster(project).catch(() => [])).find(
      (m) => m.username === session.username.toLowerCase(),
    );
    myEmail = me?.email ?? null;
    const ghContact = me?.contacts.find((c) => c.label === "GitHub")?.value;
    if (ghContact) {
      const r = await getMemberTasks(ghContact);
      if (r.ok) myTasks = r.tasks;
    }
  }

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
  const channelTabs: SplitTab[] = socials.map((channel) => ({
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
    ...socials.map((s, i): BandTile => {
      const m = channelMetrics[i];
      if (m && m.ok && m.followers != null) {
        return { label: s.platform, value: formatNumber(m.followers), delta: m.followersDelta7d, platform: s.platform };
      }
      return {
        label: s.platform,
        value: "—",
        platform: s.platform,
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

      {session && project.githubProject ? (
        <MyTasks tasks={myTasks} username={session.username} userEmail={myEmail} />
      ) : null}
    </div>
  );
}
