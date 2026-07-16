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
import { HomeTabs, type SplitTab } from "@/components/home-split";
import { loadLatestBriefing, todayIsoDate } from "@/lib/morning-briefing";
import { fetchChannelMetrics } from "@/lib/social-metrics";
import { getActiveProject, getAllProjects } from "@/projects";
import { SopaBriefing, type SopaActionGroup } from "@/components/sopa-briefing";
import { ForYou, type ForYouMention } from "@/components/for-you";
import { KanbanActivity } from "@/components/kanban-activity";
import { fetchKanbanActivity } from "@/lib/github-project";
import { MeetingCoordination } from "@/components/meeting-coordination";
import { getOpenMeetingActions } from "@/lib/meetings-context";
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
  // Content-width (doesn't stretch): one tile stays a small pill, many tiles a
  // tight row. Compact padding + type so it never dominates the tab.
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-surface">
      {tiles.map((t, i) => (
        <div
          key={`${t.label}-${i}`}
          className={`flex min-w-[84px] flex-col gap-0.5 px-3 py-1.5 ${
            i < tiles.length - 1 ? "border-r border-border" : ""
          }`}
        >
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-foreground-faint">
            {t.platform && <SocialBrandIcon platform={t.platform} className="h-2.5 w-2.5 shrink-0" />}
            {t.tone && (
              <span
                className={`h-[6px] w-[6px] shrink-0 rounded-full ${t.tone === "ok" ? "bg-success" : "bg-warning"}`}
                aria-hidden
              />
            )}
            <span className="whitespace-nowrap">{t.label}</span>
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold leading-none tracking-tight text-foreground">{t.value}</span>
            {t.delta != null && t.delta !== 0 ? (
              <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${t.delta > 0 ? "text-success" : "text-danger"}`}>
                {t.delta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                {t.delta > 0 ? "+" : ""}
                {formatNumber(t.delta)}
              </span>
            ) : (
              <span className="whitespace-nowrap text-[10px] text-foreground-faint">{t.sub ?? "—"}</span>
            )}
          </div>
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

  // SOPA home: an aggregated morning briefing — every project's next actions in
  // one view (SOPA has no briefing agent of its own).
  if (project.slug === "sopa") {
    const refs = getAllProjects()
      .filter((p) => p.slug !== "sopa")
      .flatMap((p) => p.briefingAgents.map((agent) => ({ p, agent })));
    const results = await Promise.all(refs.map(({ agent }) => loadLatestBriefing(agent)));
    const groups: SopaActionGroup[] = refs.map(({ p, agent }, i) => {
      const r = results[i];
      if (!r.ok) {
        return { projectSlug: p.slug, projectName: p.name, agentLabel: agent.label, date: null, fresh: false, actions: [], error: r.error };
      }
      const sec = r.briefing.sections.find((s) => s.kind === "actions");
      const actions = (sec?.body ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[-*•]\s+/.test(l))
        .map((l) => l.replace(/^[-*•]\s+/, "").replace(/[`*_]/g, "").trim())
        .filter(Boolean)
        .slice(0, 6);
      return { projectSlug: p.slug, projectName: p.name, agentLabel: agent.label, date: r.briefing.date, fresh: r.briefing.date === today, actions };
    });

    // --- "For You": the logged-in member's tasks + briefing mentions ---------
    const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
    let forYou: { username: string; tasks: MemberTask[]; mentions: ForYouMention[] } | null = null;
    if (session) {
      const uname = session.username.toLowerCase();
      const me = (await getTeamRoster(project).catch(() => [])).find((m) => m.username === uname);
      const gh = me?.contacts.find((c) => c.label === "GitHub")?.value;
      let tasks: MemberTask[] = [];
      if (gh) {
        const r = await getMemberTasks(gh);
        if (r.ok) tasks = r.tasks;
      }
      // Briefing next-actions that name this user (by username or GitHub handle).
      const ghNorm = gh?.toLowerCase().replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/.*$/, "");
      const needles = [uname, ghNorm].filter((x): x is string => !!x && x.length >= 3);
      const mentions: ForYouMention[] = [];
      for (const g of groups) {
        for (const a of g.actions) {
          if (needles.some((n) => new RegExp(`(^|[^a-z0-9])${n}([^a-z0-9]|$)`, "i").test(a))) {
            mentions.push({ agentLabel: g.agentLabel, text: a });
          }
        }
      }
      forYou = { username: session.username, tasks, mentions };
    }

    // GitHub kanban activity across every portal's board (straight from GitHub).
    // Open action items from recent meetings → Coordenação panel.
    const [activity, openActions] = await Promise.all([
      fetchKanbanActivity(80).catch(() => []),
      getOpenMeetingActions().catch(() => []),
    ]);
    const projectNames = Object.fromEntries(getAllProjects().map((p) => [p.slug, p.name]));

    return (
      <div className="space-y-7">
        <PageHeader eyebrow={`Daily · ${today}`} title="SOPA" description="Resumo de next actions de todos os portais." />
        {forYou ? <ForYou username={forYou.username} tasks={forYou.tasks} mentions={forYou.mentions} /> : null}
        <MeetingCoordination actions={openActions} projectNames={projectNames} today={today} />
        <SopaBriefing groups={groups} today={today} />
        <KanbanActivity events={activity} />
      </div>
    );
  }

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
  if (session && project.githubProject) {
    const me = (await getTeamRoster(project).catch(() => [])).find(
      (m) => m.username === session.username.toLowerCase(),
    );
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
          postCreatorEnabled={!!project.postCreator}
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

      <HomeTabs
        briefTabs={briefTabs}
        channelTabs={channelTabs}
        briefBand={
          tiles.filter((t) => t.label === "Briefings").length ? (
            <SummaryBand tiles={tiles.filter((t) => t.label === "Briefings")} />
          ) : null
        }
        socialBand={
          tiles.filter((t) => t.label !== "Briefings").length ? (
            <SummaryBand tiles={tiles.filter((t) => t.label !== "Briefings")} />
          ) : null
        }
        briefAbove={
          session && project.githubProject ? (
            <MyTasks tasks={myTasks} username={session.username} />
          ) : null
        }
      />
    </div>
  );
}
