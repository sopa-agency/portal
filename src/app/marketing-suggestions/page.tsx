export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { MarketingSuggestionsShell } from "@/components/marketing-suggestions-shell";
import { RepoToSocialShell } from "@/components/repo-to-social-shell";
import { PostSuggestionTabs } from "@/components/post-suggestion-tabs";
import {
  getMarketingSuggestionConfig,
  getRecentMarketingSuggestionRuns,
  getMarketingSuggestionWorkerHealth,
  type MarketingSuggestionConfig,
  type MarketingSuggestionRunRow,
  type MarketingSuggestionWorkerHealth,
} from "@/app/actions/marketing-suggestions";
import { listUnifiedCalendar } from "@/app/actions/post-creator";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import {
  getRepoToSocialConfig,
  getRecentRepoToSocialRuns,
  getRepoToSocialWorkerHealth,
  type RepoToSocialWorkerHealth,
  type RepoToSocialRunRow,
} from "@/app/actions/repo-to-social";
import { getActiveProject } from "@/projects";
import { tweetBrand } from "@/lib/project-brand";

// Consolidated suggestions page: community-driven drafts (Post Suggestions)
// and commit-driven drafts (the former /repo-to-social route) as two tabs.

const DEFAULT_CONFIG: MarketingSuggestionConfig = {
  prompt: "",
  useTopPosts: true,
  useBriefing: true,
  useTopCreators: true,
  freePromptHint: "",
};

const DEFAULT_SUGGESTION_HEALTH: MarketingSuggestionWorkerHealth = {
  status: "degraded",
  db: "unreachable",
  worker: "unknown",
  pendingJobs: 0,
  lastHeartbeat: null,
  checkedAt: new Date().toISOString(),
  reason: "Database unreachable. Set DATABASE_URL in .env.local and run `npx prisma db push`.",
};

const DEFAULT_REPO_HEALTH: RepoToSocialWorkerHealth = {
  status: "degraded",
  db: "unreachable",
  worker: "unknown",
  pendingJobs: 0,
  lastHeartbeat: null,
  checkedAt: new Date().toISOString(),
  reason: "Database unreachable. Set DATABASE_URL in .env.local and run `npm run db:push`.",
};

function HealthBanner({ down, reason }: { down: boolean; reason: string | null | undefined }) {
  if (down) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-3 text-sm text-amber-200">
        {reason ?? "Backend offline."}
      </div>
    );
  }
  if (reason) {
    return (
      <div className="rounded-2xl border border-border bg-surface/40 px-5 py-3 text-sm text-foreground-muted">
        {reason}
      </div>
    );
  }
  return null;
}

export default async function MarketingSuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const [
    projectResult,
    configResult,
    runsResult,
    healthResult,
    repoConfigResult,
    repoRunsResult,
    repoHealthResult,
    calendarResult,
  ] = await Promise.allSettled([
    getActiveProject(),
    getMarketingSuggestionConfig(),
    getRecentMarketingSuggestionRuns(),
    getMarketingSuggestionWorkerHealth(),
    getRepoToSocialConfig(),
    getRecentRepoToSocialRuns(),
    getRepoToSocialWorkerHealth(),
    listUnifiedCalendar(),
  ]);

  const project = projectResult.status === "fulfilled" ? projectResult.value : null;
  const projectName = project?.name ?? "the community";
  const brand = project
    ? tweetBrand(project)
    : { name: projectName, handle: "", avatarUrl: "/favicon.ico" };

  // --- community tab --------------------------------------------------------
  const config = configResult.status === "fulfilled" ? configResult.value : DEFAULT_CONFIG;
  const runs =
    runsResult.status === "fulfilled" ? runsResult.value : ([] as MarketingSuggestionRunRow[]);
  const health =
    healthResult.status === "fulfilled" ? healthResult.value : DEFAULT_SUGGESTION_HEALTH;

  const community = (
    <div className="space-y-6">
      <HealthBanner down={health.db === "unreachable"} reason={health.reason} />
      <MarketingSuggestionsShell
        config={config}
        runs={runs}
        health={health}
        projectName={projectName}
        brand={brand}
      />
    </div>
  );

  // --- repo tab --------------------------------------------------------------
  const defaultRepoUrl = project?.repos?.[0] ? `https://github.com/${project.repos[0]}` : "";
  const repoConfig =
    repoConfigResult.status === "fulfilled"
      ? repoConfigResult.value
      : { id: "singleton", repoUrl: defaultRepoUrl, prompt: "" };
  const repoRuns =
    repoRunsResult.status === "fulfilled"
      ? repoRunsResult.value
      : ([] as RepoToSocialRunRow[]);
  const repoHealth =
    repoHealthResult.status === "fulfilled" ? repoHealthResult.value : DEFAULT_REPO_HEALTH;

  // Repos this feature reads — parsed from the config (newline/comma list).
  const watchedRepos = (repoConfig.repoUrl ?? "")
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => ({
      url: u.startsWith("http") ? u : `https://github.com/${u}`,
      label: u.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, ""),
    }));

  const repo = (
    <div className="space-y-6">
      <HealthBanner down={repoHealth.db === "unreachable"} reason={repoHealth.reason} />
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-2.5 text-xs">
        <span className="font-semibold uppercase tracking-wider text-foreground-subtle">
          Reading commits from
        </span>
        {watchedRepos.length === 0 ? (
          <span className="italic text-foreground-faint">
            no repo configured — set one in the config below
          </span>
        ) : (
          watchedRepos.map((r) => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-2.5 py-1 font-mono text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              <SocialBrandIcon platform="github" className="h-3 w-3" />
              {r.label}
            </a>
          ))
        )}
      </div>
      <RepoToSocialShell
        config={{ repoUrl: repoConfig.repoUrl, prompt: repoConfig.prompt }}
        runs={repoRuns}
        health={repoHealth}
        repoPlaceholder={defaultRepoUrl || "https://github.com/owner/repo"}
        brand={brand}
      />
    </div>
  );

  const calendarEvents =
    calendarResult.status === "fulfilled" && calendarResult.value.ok
      ? calendarResult.value.events
      : [];
  const calendar = (
    <ScheduleCalendar events={calendarEvents} activeSlug={project?.slug ?? ""} />
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Marketing"
        title="Post Suggestions"
        description={`Ready-to-post drafts for ${projectName} — from community activity (top creators, best posts, what's happening) or straight from repo commits. One run, multiple platforms.`}
        status={`workers: community ${health.worker} · repo ${repoHealth.worker}`}
      />
      <PostSuggestionTabs
        initial={tab === "repo" ? "repo" : tab === "calendar" ? "calendar" : "community"}
        community={community}
        repo={repo}
        calendar={calendar}
      />
    </div>
  );
}
