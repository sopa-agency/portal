export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { MarketingSuggestionsShell } from "@/components/marketing-suggestions-shell";
import {
  getMarketingSuggestionConfig,
  getRecentMarketingSuggestionRuns,
  getMarketingSuggestionWorkerHealth,
  type MarketingSuggestionConfig,
  type MarketingSuggestionRunRow,
  type MarketingSuggestionWorkerHealth,
} from "@/app/actions/marketing-suggestions";
import { getActiveProject } from "@/projects";

const DEFAULT_CONFIG: MarketingSuggestionConfig = {
  prompt: "",
  useTopPosts: true,
  useBriefing: true,
  useTopCreators: true,
  freePromptHint: "",
};

const DEFAULT_HEALTH: MarketingSuggestionWorkerHealth = {
  status: "degraded",
  db: "unreachable",
  worker: "unknown",
  pendingJobs: 0,
  lastHeartbeat: null,
  checkedAt: new Date().toISOString(),
  reason: "Database unreachable. Set DATABASE_URL in .env.local and run `npx prisma db push`.",
};

export default async function MarketingSuggestionsPage() {
  const [projectResult, configResult, runsResult, healthResult] = await Promise.allSettled([
    getActiveProject(),
    getMarketingSuggestionConfig(),
    getRecentMarketingSuggestionRuns(),
    getMarketingSuggestionWorkerHealth(),
  ]);

  const project = projectResult.status === "fulfilled" ? projectResult.value : null;
  const projectName = project?.name ?? "the community";
  const config = configResult.status === "fulfilled" ? configResult.value : DEFAULT_CONFIG;
  const runs =
    runsResult.status === "fulfilled"
      ? runsResult.value
      : ([] as MarketingSuggestionRunRow[]);
  const health = healthResult.status === "fulfilled" ? healthResult.value : DEFAULT_HEALTH;

  const backendDown = health.db === "unreachable";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Marketing"
        title="Post Suggestions"
        description={`Generates ready-to-post drafts about the ${projectName} community — top creators, best recent posts, and what's happening this week. One run, multiple platforms.`}
        status={`worker: ${health.worker}`}
      />

      {backendDown && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-3 text-sm text-amber-200">
          {health.reason ?? "Backend offline."}
        </div>
      )}

      {!backendDown && health.reason && (
        <div className="rounded-2xl border border-border bg-surface/40 px-5 py-3 text-sm text-foreground-muted">
          {health.reason}
        </div>
      )}

      <MarketingSuggestionsShell config={config} runs={runs} health={health} projectName={projectName} />
    </div>
  );
}
