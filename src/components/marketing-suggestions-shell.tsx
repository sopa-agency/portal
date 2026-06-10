"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  enqueueMarketingSuggestionRun,
  saveMarketingSuggestionConfig,
  type MarketingSuggestionConfig,
  type MarketingSuggestionRunRow,
  type MarketingSuggestionWorkerHealth,
} from "@/app/actions/marketing-suggestions";
import { MarketingSuggestionsDialog } from "@/components/marketing-suggestions-batch-dialog";
import type { TweetBrand } from "@/components/tweet-batch-dialog";
import { effectiveTweetStatus } from "@/components/tweet-batch-dialog";

type KanbanColId = "generating" | "drafted" | "approved" | "published";

const KANBAN_COLUMNS: { id: KanbanColId; label: string; accent: string; border: string }[] = [
  { id: "generating", label: "Generating", accent: "text-amber-400", border: "border-amber-400/20" },
  { id: "drafted", label: "Drafts", accent: "text-foreground-muted", border: "border-border" },
  { id: "approved", label: "Approved", accent: "text-accent", border: "border-accent-border" },
  { id: "published", label: "Published", accent: "text-emerald-400", border: "border-emerald-400/20" },
];

type DraftCard = {
  id: string;
  run: MarketingSuggestionRunRow;
  tweetIndex: number | null;
  tweetText: string | null;
};

function expandRunsToCards(runs: MarketingSuggestionRunRow[]): DraftCard[] {
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

function PlatformDots({
  run,
  tweetIndex,
}: {
  run: MarketingSuggestionRunRow;
  tweetIndex: number | null;
}) {
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
  onSelect: (run: MarketingSuggestionRunRow, tweetIndex: number | null) => void;
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
        <p className="mb-2 text-sm text-foreground-subtle">No posts generated.</p>
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
  generating: "Click “Suggest posts” to queue a run.",
  drafted: "Drafts will land here once generated.",
  approved: "Approve a draft to move it here.",
  published: "Posted suggestions show up here.",
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
  onSelect: (run: MarketingSuggestionRunRow, tweetIndex: number | null) => void;
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
  runs: MarketingSuggestionRunRow[];
  selectedId: string | null;
  onSelect: (run: MarketingSuggestionRunRow, tweetIndex: number | null) => void;
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
  config,
  health,
  runs,
  projectName,
}: {
  config: MarketingSuggestionConfig;
  health: MarketingSuggestionWorkerHealth;
  runs: MarketingSuggestionRunRow[];
  projectName: string;
}) {
  const router = useRouter();
  const [freePrompt, setFreePrompt] = useState("");
  const [isRunning, startRunning] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const lastRun = runs[0] ?? null;
  const enabledSources = [
    config.useTopPosts && "top posts",
    config.useTopCreators && "top creators",
    config.useBriefing && "marketing briefing",
  ].filter(Boolean) as string[];

  const handleRun = () => {
    setMessage(null);
    startRunning(async () => {
      const result = await enqueueMarketingSuggestionRun(freePrompt.trim() || undefined);
      if (result.ok) {
        setMessage(`Queued run ${result.runId?.slice(0, 8)}.`);
        setFreePrompt("");
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
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-subtle">
          Suggest community posts
        </p>
        <p className="mt-0.5 text-xs text-foreground-subtle">
          {enabledSources.length === 0
            ? "No sources enabled — open Settings to turn some on."
            : `Pulls ${enabledSources.join(" + ")} and drafts posts about the ${projectName} community.`}
        </p>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
          Theme or focus (optional)
        </label>
        <input
          type="text"
          value={freePrompt}
          onChange={(e) => setFreePrompt(e.target.value)}
          placeholder={config.freePromptHint || "e.g. mini ramp jam, welcome new skaters, recap the week"}
          className="mt-1 w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-accent">{message ?? ""}</span>
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning || enabledSources.length === 0}
          title={
            enabledSources.length === 0 ? "Enable at least one source in Settings first" : undefined
          }
          className="inline-flex items-center gap-1.5 rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-xs font-medium text-accent transition-all hover:bg-accent/20 disabled:opacity-50"
        >
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isRunning ? "Queuing…" : "Suggest posts"}
        </button>
      </div>

      {health.worker === "offline" && (
        <div className="rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-red-300/90">
          Worker is not running. Queued jobs will sit until you start it with{" "}
          <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono">
            npm run worker:marketing-suggestions
          </code>
          .
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
            Last run:{" "}
            <span className="text-foreground-muted">{formatRelative(lastRun.startedAt)}</span>
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
            {lastRun.tweets.length > 0 && ` · ${lastRun.tweets.length} posts`}
          </span>
        )}
        {!lastRun && <span>No runs yet</span>}
      </div>
    </div>
  );
}

function SettingsAccordion({
  config,
  setConfig,
  isSaving,
  onSave,
}: {
  config: MarketingSuggestionConfig;
  setConfig: (patch: Partial<MarketingSuggestionConfig>) => void;
  isSaving: boolean;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sourcesSummary = [
    config.useTopPosts && "posts",
    config.useTopCreators && "creators",
    config.useBriefing && "briefing",
  ]
    .filter(Boolean)
    .join(" + ") || "none";

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-white/[0.02] to-transparent">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left transition-colors hover:bg-surface/70"
      >
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-subtle">
            Settings
          </p>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-faint">
            sources: {sourcesSummary}
          </span>
        </div>
        <span className="text-xs text-foreground-faint">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-5 py-5">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              Sources to feed the agent
            </label>
            <div className="space-y-2">
              <SourceToggle
                checked={config.useTopPosts}
                onChange={(v) => setConfig({ useTopPosts: v })}
                title="Top Hive posts"
                desc="Trending posts from the community Hive feed this past week."
              />
              <SourceToggle
                checked={config.useTopCreators}
                onChange={(v) => setConfig({ useTopCreators: v })}
                title="Top creators"
                desc="Leaderboard derived from the week's top posts (by votes + payout)."
              />
              <SourceToggle
                checked={config.useBriefing}
                onChange={(v) => setConfig({ useBriefing: v })}
                title="Marketing briefing"
                desc="Preamble of today's marketing briefing, if available."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              Theme placeholder
            </label>
            <input
              type="text"
              value={config.freePromptHint}
              onChange={(e) => setConfig({ freePromptHint: e.target.value })}
              placeholder="e.g. tag a creator, recap the week, welcome newcomers"
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
            <p className="text-[11px] text-foreground-faint">
              Shown as the placeholder in the &ldquo;Theme or focus&rdquo; field above.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              Generation prompt
            </label>
            <textarea
              value={config.prompt}
              onChange={(e) => setConfig({ prompt: e.target.value })}
              rows={10}
              className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
            <p className="text-[11px] text-foreground-faint">
              Instructions shaping tone and format. The agent receives this plus the enabled
              sources and your theme.
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

function SourceToggle({
  checked,
  onChange,
  title,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        checked
          ? "border-accent-border bg-accent-bg/40"
          : "border-border bg-surface-elevated hover:bg-foreground/5"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-lime-400"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${checked ? "text-accent" : "text-foreground"}`}>
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-foreground-subtle">{desc}</p>
      </div>
    </label>
  );
}

export function MarketingSuggestionsShell({
  config: initialConfig,
  runs: initialRuns,
  health,
  projectName = "the community",
  brand,
}: {
  config: MarketingSuggestionConfig;
  runs: MarketingSuggestionRunRow[];
  health: MarketingSuggestionWorkerHealth;
  projectName?: string;
  brand: TweetBrand;
}) {
  const router = useRouter();
  const [config, setConfigState] = useState(initialConfig);
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

  const updateConfig = (patch: Partial<MarketingSuggestionConfig>) => {
    setConfigState((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    startSaving(async () => {
      await saveMarketingSuggestionConfig(config);
    });
  };

  const handleRunUpdate = (
    patch: Partial<MarketingSuggestionRunRow> & { id: string },
  ) => {
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
            {activeJobCount} generation{activeJobCount > 1 ? "s" : ""} in progress —
            refreshing every 3s
          </p>
        </div>
      )}

      <TriggerPanel config={config} health={health} runs={runs} projectName={projectName} />

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
        config={config}
        setConfig={updateConfig}
        isSaving={isSaving}
        onSave={handleSave}
      />

      <MarketingSuggestionsDialog
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
