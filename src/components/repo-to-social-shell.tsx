"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  enqueueRepoToSocialRun,
  saveRepoToSocialConfig,
  type RepoToSocialWorkerHealth,
  type RepoToSocialRunRow,
} from "@/app/actions/repo-to-social";
import { parseRepoUrls, repoUrlToLabel } from "@/lib/repo-to-social-utils";
import { RepoToSocialDialog } from "@/components/repo-to-social-batch-dialog";
import type { TweetBrand } from "@/components/tweet-batch-dialog";
import { effectiveTweetStatus as effectiveTweetStatusBase } from "@/components/tweet-batch-dialog";

type Config = {
  repoUrl: string;
  prompt: string;
  repoPlaceholder?: string;
};

type KanbanColId = "generating" | "drafted" | "approved" | "published";

const KANBAN_COLUMNS: { id: KanbanColId; label: string; accent: string; border: string }[] = [
  { id: "generating", label: "Generating", accent: "text-amber-400", border: "border-amber-400/20" },
  { id: "drafted", label: "Drafts", accent: "text-foreground-muted", border: "border-border" },
  { id: "approved", label: "Approved", accent: "text-accent", border: "border-accent-border" },
  { id: "published", label: "Published", accent: "text-emerald-400", border: "border-emerald-400/20" },
];

// Re-exported for back-compat with anything that imported it from this shell.
// The real implementation now lives in tweet-batch-dialog.
export const effectiveTweetStatus = effectiveTweetStatusBase;

type DraftCard = {
  id: string;
  run: RepoToSocialRunRow;
  tweetIndex: number | null;
  tweetText: string | null;
};

function expandRunsToCards(runs: RepoToSocialRunRow[]): DraftCard[] {
  const out: DraftCard[] = [];
  for (const run of runs) {
    const isProcessing = run.jobStatus === "pending" || run.jobStatus === "running";
    if (isProcessing || run.tweets.length === 0) {
      out.push({ id: `${run.id}:meta`, run, tweetIndex: null, tweetText: null });
      continue;
    }
    run.tweets.forEach((tweetText, i) => {
      out.push({ id: `${run.id}:${i}`, run, tweetIndex: i, tweetText });
    });
  }
  return out;
}

function bucketForCard(card: DraftCard): KanbanColId {
  if (card.run.jobStatus === "pending" || card.run.jobStatus === "running") return "generating";
  const status = effectiveTweetStatus(card.run, card.tweetIndex);
  if (status === "approved") return "approved";
  if (status === "published") return "published";
  if (status === "skipped") return "published";
  return "drafted";
}

function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function PlatformDots({ run, tweetIndex }: { run: RepoToSocialRunRow; tweetIndex: number | null }) {
  const state = tweetIndex !== null ? run.tweetStates?.[String(tweetIndex)] : undefined;
  const pub = state?.publishedTo ?? {};
  const platforms: { key: "x" | "hive" | "farcaster"; label: string; color: string }[] = [
    { key: "x", label: "X", color: "bg-zinc-300 text-black" },
    { key: "hive", label: "H", color: "bg-red-400/80 text-black" },
    { key: "farcaster", label: "F", color: "bg-purple-400/80 text-black" },
  ];
  const posted = platforms.filter((p) => pub[p.key]);
  if (posted.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5" aria-label="published to">
      {posted.map((p) => (
        <span
          key={p.key}
          title={`Posted on ${p.label === "X" ? "X" : p.label === "H" ? "Hive" : "Farcaster"}`}
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold ${p.color}`}
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}

function KanbanCard({
  card,
  isSelected,
  onSelect,
}: {
  card: DraftCard;
  isSelected: boolean;
  onSelect: (run: RepoToSocialRunRow, tweetIndex: number | null) => void;
}) {
  const { run, tweetIndex, tweetText } = card;
  const isProcessing = run.jobStatus === "pending" || run.jobStatus === "running";
  const totalTweets = run.tweets.length;
  const tweetStatus = effectiveTweetStatus(run, tweetIndex);

  return (
    <button
      type="button"
      onClick={() => onSelect(run, tweetIndex)}
      className={`block w-full rounded-xl border px-3 py-3 text-left transition-all ${
        isSelected
          ? "border-accent-border bg-surface-elevated ring-1 ring-accent/30"
          : "border-border bg-surface/70 hover:border-border-strong hover:bg-surface-elevated"
      }`}
    >
      {tweetText ? (
        <p className="mb-2 line-clamp-5 text-sm leading-relaxed text-foreground">{tweetText}</p>
      ) : isProcessing ? (
        <p className="mb-2 flex items-start gap-2 text-sm text-amber-400/70">
          <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span>
            {run.statusMessage ??
              (run.jobStatus === "pending" ? "Queued — waiting for worker…" : "Working…")}
          </span>
        </p>
      ) : run.error ? (
        <p className="mb-2 line-clamp-2 text-sm text-red-400">{run.error}</p>
      ) : (
        <p className="mb-2 text-sm text-foreground-subtle">No tweets generated.</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-foreground-subtle">{formatRelative(run.startedAt)}</span>
          <PlatformDots run={run} tweetIndex={tweetIndex} />
        </div>
        <div className="flex items-center gap-1.5">
          {tweetIndex !== null && totalTweets > 1 && (
            <span className="text-[10px] text-foreground-subtle">
              {tweetIndex + 1} / {totalTweets}
            </span>
          )}
          {tweetStatus === "approved" && (
            <span className="rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] text-accent">
              ready
            </span>
          )}
          {tweetStatus === "skipped" && (
            <span className="rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-foreground-muted">
              skipped
            </span>
          )}
          {isProcessing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />}
        </div>
      </div>
    </button>
  );
}

const COLUMN_EMPTY_HINT: Record<KanbanColId, string> = {
  generating: "Click “Generate now” to queue a run.",
  drafted: "Drafts will land here once generated.",
  approved: "Approve a draft to move it here.",
  published: "Posted tweets show up here.",
};

function KanbanColumn({
  col,
  cards,
  selectedId,
  onSelect,
}: {
  col: (typeof KANBAN_COLUMNS)[number];
  cards: DraftCard[];
  selectedId: string | null;
  onSelect: (run: RepoToSocialRunRow, tweetIndex: number | null) => void;
}) {
  return (
    <div className={`flex min-w-0 flex-col rounded-2xl border ${col.border} bg-surface/50`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className={`text-[11px] font-medium uppercase tracking-[0.14em] ${col.accent}`}>
          {col.label}
        </span>
        {cards.length > 0 && (
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] text-foreground-subtle">
            {cards.length}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {cards.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-3 py-6">
            <p className="text-center text-[11px] leading-relaxed text-foreground-faint">
              {COLUMN_EMPTY_HINT[col.id]}
            </p>
          </div>
        ) : (
          cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              isSelected={card.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanBoard({
  runs,
  selectedId,
  onSelect,
}: {
  runs: RepoToSocialRunRow[];
  selectedId: string | null;
  onSelect: (run: RepoToSocialRunRow, tweetIndex: number | null) => void;
}) {
  const buckets: Record<KanbanColId, DraftCard[]> = {
    generating: [],
    drafted: [],
    approved: [],
    published: [],
  };
  for (const card of expandRunsToCards(runs)) {
    buckets[bucketForCard(card)].push(card);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {KANBAN_COLUMNS.map((col) => (
        <KanbanColumn
          key={col.id}
          col={col}
          cards={buckets[col.id]}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TriggerPanel({
  repoUrl,
  health,
  runs,
}: {
  repoUrl: string;
  health: RepoToSocialWorkerHealth;
  runs: RepoToSocialRunRow[];
}) {
  const router = useRouter();
  const [isRunning, startRunning] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const lastRun = runs[0] ?? null;
  const parsedUrls = parseRepoUrls(repoUrl);
  const repoLabel =
    parsedUrls.length === 0
      ? "no repository configured"
      : parsedUrls.length === 1
        ? repoUrlToLabel(parsedUrls[0])
        : `${parsedUrls.length} repos`;
  const hasRepo = parsedUrls.length > 0;

  const handleRun = () => {
    setMessage(null);
    startRunning(async () => {
      const result = await enqueueRepoToSocialRun();
      if (result.ok) {
        setMessage(`Queued run ${result.runId?.slice(0, 8)}.`);
        setTimeout(() => {
          setMessage(null);
          router.refresh();
        }, 1500);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    });
  };

  const workerLabel =
    health.worker === "active"
      ? "active"
      : health.worker === "idle"
        ? "running (idle)"
        : health.worker === "stale"
          ? "stale"
          : health.worker === "offline"
            ? "not running"
            : "unknown";

  const workerColor =
    health.worker === "active" || health.worker === "idle"
      ? "text-emerald-300"
      : health.worker === "stale"
        ? "text-amber-300"
        : "text-red-300";

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-subtle">Generate</p>
          <p className="mt-0.5 truncate text-xs text-foreground-subtle">
            Pulls recent commits from <span className="text-foreground-muted">{repoLabel}</span> and generates tweet drafts.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message && <span className="text-[11px] text-accent">{message}</span>}
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || !hasRepo}
            title={!hasRepo ? "Configure at least one repository URL first" : undefined}
            className="inline-flex items-center gap-1.5 rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-xs font-medium text-accent transition-all hover:bg-accent/20 disabled:opacity-50"
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isRunning ? "Queuing…" : "Generate now"}
          </button>
        </div>
      </div>

      {health.worker === "offline" && (
        <div className="rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-red-300/90">
          Worker is not running. Queued jobs will sit until you start it with{" "}
          <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono">npm run worker:repo-to-social</code>.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3 text-[11px] text-foreground-subtle">
        <span>
          Worker: <span className={workerColor}>{workerLabel}</span>
        </span>
        <span>
          DB:{" "}
          <span className={health.db === "connected" ? "text-emerald-300" : "text-red-300"}>
            {health.db}
          </span>
        </span>
        {health.pendingJobs > 0 && (
          <span>
            Queue: <span className="text-amber-300">{health.pendingJobs} pending</span>
          </span>
        )}
        {lastRun && (
          <span>
            Last run: <span className="text-foreground-muted">{formatRelative(lastRun.startedAt)}</span>
            {" · "}
            <span
              className={
                lastRun.status === "success"
                  ? "text-emerald-400"
                  : lastRun.status === "error"
                    ? "text-red-400"
                    : "text-foreground-muted"
              }
            >
              {lastRun.jobStatus ?? lastRun.status}
            </span>
            {lastRun.tweets.length > 0 && ` · ${lastRun.tweets.length} tweets`}
          </span>
        )}
        {!lastRun && <span>No runs yet</span>}
      </div>
    </div>
  );
}

function SettingsAccordion({
  repoUrl,
  setRepoUrl,
  prompt,
  setPrompt,
  isSaving,
  onSave,
  repoPlaceholder,
}: {
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  isSaving: boolean;
  onSave: () => void;
  repoPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = parseRepoUrls(repoUrl);
  const summary =
    list.length === 0 ? "no repositories set" : list.length === 1 ? repoUrlToLabel(list[0]) : `${list.length} repos`;

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-white/[0.02] to-transparent">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left transition-colors hover:bg-surface/70"
      >
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-subtle">Settings</p>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-faint">
            {summary}
          </span>
        </div>
        <span className="text-xs text-foreground-faint">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-5 py-5">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              Source repository URL (GitHub)
            </label>
            <textarea
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              rows={3}
              placeholder={repoPlaceholder ?? "https://github.com/owner/repo"}
              className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
            <p className="text-[11px] text-foreground-faint">
              One repository per line. Commits from each are merged by date before drafting tweets.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">Tweet generation prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
            <p className="text-[11px] text-foreground-faint">
              Instructions shaping tone and format of generated tweets.
            </p>
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </div>
  );
}

export function RepoToSocialShell({
  config: initialConfig,
  runs: initialRuns,
  health,
  repoPlaceholder,
  brand,
}: {
  config: Config;
  runs: RepoToSocialRunRow[];
  health: RepoToSocialWorkerHealth;
  repoPlaceholder?: string;
  brand: TweetBrand;
}) {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState(initialConfig.repoUrl);
  const [prompt, setPrompt] = useState(initialConfig.prompt);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [focusedTweetIndex, setFocusedTweetIndex] = useState<number | null>(null);
  const [isSaving, startSaving] = useTransition();

  const prevInitialRuns = useRef(initialRuns);
  useEffect(() => {
    if (prevInitialRuns.current !== initialRuns) {
      prevInitialRuns.current = initialRuns;
      setRuns(initialRuns);
    }
  }, [initialRuns]);

  const activeJobCount = runs.filter(
    (r) => r.jobStatus === "pending" || r.jobStatus === "running",
  ).length;

  useEffect(() => {
    if (activeJobCount === 0) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [activeJobCount, router]);

  const handleSave = () => {
    startSaving(async () => {
      await saveRepoToSocialConfig({ repoUrl, prompt });
    });
  };

  const handleRunUpdate = (patch: Partial<RepoToSocialRunRow> & { id: string }) => {
    const isDeletion = Object.keys(patch).length === 1;
    if (isDeletion) {
      setRuns((prev) => prev.filter((r) => r.id !== patch.id));
      return;
    }
    setRuns((prev) => prev.map((r) => (r.id === patch.id ? { ...r, ...patch } : r)));
  };

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  return (
    <div className="space-y-6">
      {activeJobCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 py-3">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <p className="text-sm text-foreground-muted">
            {activeJobCount} generation{activeJobCount > 1 ? "s" : ""} in progress — refreshing every 3s
          </p>
        </div>
      )}

      <TriggerPanel repoUrl={repoUrl} health={health} runs={runs} />

      <KanbanBoard
        runs={runs}
        selectedId={
          selectedRunId
            ? `${selectedRunId}:${focusedTweetIndex === null ? "meta" : focusedTweetIndex}`
            : null
        }
        onSelect={(r, idx) => {
          setSelectedRunId(r.id);
          setFocusedTweetIndex(idx);
        }}
      />

      <SettingsAccordion
        repoUrl={repoUrl}
        setRepoUrl={setRepoUrl}
        prompt={prompt}
        setPrompt={setPrompt}
        isSaving={isSaving}
        onSave={handleSave}
        repoPlaceholder={repoPlaceholder}
      />

      <RepoToSocialDialog
        run={selectedRun}
        brand={brand}
        open={selectedRun !== null}
        focusTweetIndex={focusedTweetIndex}
        onFocusTweetIndexChange={setFocusedTweetIndex}
        onClose={() => {
          setSelectedRunId(null);
          setFocusedTweetIndex(null);
        }}
        onUpdate={handleRunUpdate}
      />
    </div>
  );
}
