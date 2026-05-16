export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { RepoToSocialShell } from "@/components/repo-to-social-shell";
import {
  getRepoToSocialConfig,
  getRecentRepoToSocialRuns,
  getRepoToSocialWorkerHealth,
  type RepoToSocialWorkerHealth,
  type RepoToSocialRunRow,
} from "@/app/actions/repo-to-social";

const DEFAULT_CONFIG = {
  id: "singleton",
  repoUrl: "https://github.com/SkateHive/skatehive3.0",
  prompt: "",
};

const DEFAULT_HEALTH: RepoToSocialWorkerHealth = {
  status: "degraded",
  db: "unreachable",
  worker: "unknown",
  pendingJobs: 0,
  lastHeartbeat: null,
  checkedAt: new Date().toISOString(),
  reason: "Database unreachable. Set DATABASE_URL in .env.local and run `npm run db:push`.",
};

export default async function RepoToSocialPage() {
  const [configResult, runsResult, healthResult] = await Promise.allSettled([
    getRepoToSocialConfig(),
    getRecentRepoToSocialRuns(),
    getRepoToSocialWorkerHealth(),
  ]);

  const config = configResult.status === "fulfilled" ? configResult.value : DEFAULT_CONFIG;
  const runs =
    runsResult.status === "fulfilled" ? runsResult.value : ([] as RepoToSocialRunRow[]);
  const health = healthResult.status === "fulfilled" ? healthResult.value : DEFAULT_HEALTH;

  const backendDown = health.db === "unreachable";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Automation"
        title="Repo to Social"
        description="Pulls recent commits from a SkateHive repo and turns them into post drafts. Trigger a run, review, edit, and publish."
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

      <RepoToSocialShell
        config={{ repoUrl: config.repoUrl, prompt: config.prompt }}
        runs={runs}
        health={health}
      />
    </div>
  );
}
