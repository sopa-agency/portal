"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Trash2,
  MessageCircle,
  Repeat2,
  Heart,
  BarChart3,
  Bookmark,
  Share,
  Loader2,
  ImagePlus,
  Clock,
} from "lucide-react";
import type { Platform, SchedulablePlatform } from "@/lib/social-publish";

// Generic shape every "run" must satisfy so this dialog can render it. Both
// RepoToSocialRunRow and MarketingSuggestionRunRow extend this with extra
// fields the dialog doesn't care about — the dialog only reads what's here.
export type TweetRunData = {
  id: string;
  status: string;
  jobStatus: string | null;
  editorialStatus: string;
  inputSummary: string | null;
  statusMessage: string | null;
  tweets: string[];
  tweetStates: TweetStateMap;
  error: string | null;
  startedAt: Date;
};

export type TweetStatus = "drafted" | "approved" | "skipped" | "published";

export type TweetState = {
  status: TweetStatus;
  approvedBy?: string;
  approvedAt?: string;
  publishedAt?: string;
  publishedTo?: Partial<Record<Platform, { at: string; url?: string; ref?: string }>>;
  scheduledFor?: Partial<Record<SchedulablePlatform, string>>;
};

export type TweetStateMap = Record<string, TweetState>;

// Plain object of the 9 server actions the dialog needs. Each pipeline
// (Repo-to-Social, Marketing Suggestions) supplies its own bound version
// so the same UI can write to either Prisma table.
export type TweetBatchActions = {
  updateRunTweets: (
    id: string,
    tweets: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
  setTweetState: (
    runId: string,
    tweetIndex: number,
    status: TweetStatus,
    actor?: string,
  ) => Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }>;
  scheduleTweetPublish: (
    runId: string,
    tweetIndex: number,
    platform: SchedulablePlatform,
    whenISO: string,
  ) => Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }>;
  cancelScheduledTweet: (
    runId: string,
    tweetIndex: number,
    platform: SchedulablePlatform,
  ) => Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }>;
  deleteRun: (id: string) => Promise<{ ok: boolean; error?: string }>;
  publishTweetToHive: (
    runId: string,
    tweetIndex: number,
  ) => Promise<{
    ok: boolean;
    url?: string;
    tweetStates?: TweetStateMap;
    error?: string;
  }>;
  publishTweetToFarcaster: (
    runId: string,
    tweetIndex: number,
  ) => Promise<{
    ok: boolean;
    url?: string;
    tweetStates?: TweetStateMap;
    error?: string;
  }>;
  publishTweetToBinance: (
    runId: string,
    tweetIndex: number,
  ) => Promise<{
    ok: boolean;
    url?: string;
    tweetStates?: TweetStateMap;
    error?: string;
  }>;
  recordXPublish: (
    runId: string,
    tweetIndex: number,
  ) => Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }>;
  uploadDraftImage: (
    formData: FormData,
  ) => Promise<{ ok: boolean; url?: string; error?: string }>;
};

export function effectiveTweetStatus<R extends TweetRunData>(
  run: R,
  tweetIndex: number | null,
): TweetStatus {
  if (tweetIndex !== null) {
    const state = run.tweetStates?.[String(tweetIndex)];
    if (state) return state.status;
  }
  if (run.editorialStatus === "approved") return "approved";
  if (run.editorialStatus === "published") return "published";
  if (run.editorialStatus === "skipped") return "skipped";
  return "drafted";
}

// The dialog only mutates fields it knows about (tweets/tweetStates), so the
// onUpdate signature uses the base shape. Callsites pass an onUpdate bound
// to their concrete row type — the extra fields just stay untouched.
export type TweetRunPatch = Partial<TweetRunData> & { id: string };

/** Active project's identity for the X-style preview card. */
export type TweetBrand = {
  name: string;
  handle: string;
  avatarUrl: string;
};

type Props<R extends TweetRunData> = {
  run: R | null;
  open: boolean;
  focusTweetIndex: number | null;
  onFocusTweetIndexChange: (idx: number | null) => void;
  onClose: () => void;
  onUpdate: (patch: TweetRunPatch) => void;
  actions: TweetBatchActions;
  brand: TweetBrand;
};

// X intent URLs only accept text — there is no way to attach media. So when the
// tweet body contains a markdown image, we strip it from the text and copy the
// image bytes to the clipboard (or open it in a tab as a fallback). The user
// pastes / drops it into the X compose window manually.
function extractFirstMarkdownImage(text: string): { cleanText: string; imageUrl?: string } {
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;
  const match = text.match(re);
  if (!match) return { cleanText: text };
  const cleanText = text.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText, imageUrl: match[1] };
}

async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/png",
    ),
  );
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatScheduledFor(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function copyImageOrOpen(imageUrl: string): Promise<{ copied: boolean }> {
  try {
    const res = await fetch(imageUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    const png = await blobToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return { copied: true };
  } catch {
    window.open(imageUrl, "_blank", "noopener");
    return { copied: false };
  }
}

const TRANSITIONS: Record<
  TweetStatus,
  { next: TweetStatus; label: string; tone: "approve" | "neutral" }[]
> = {
  drafted: [
    { next: "approved", label: "Approve", tone: "approve" },
    { next: "skipped", label: "Skip", tone: "neutral" },
  ],
  approved: [{ next: "drafted", label: "Back to draft", tone: "neutral" }],
  published: [{ next: "drafted", label: "Reopen", tone: "neutral" }],
  skipped: [{ next: "drafted", label: "Reopen", tone: "neutral" }],
};

const TONE_CLASS: Record<"approve" | "neutral", string> = {
  approve: "border-accent-border bg-accent-bg text-accent hover:bg-accent/20",
  neutral: "border-border bg-foreground/5 text-foreground-muted hover:bg-foreground/10",
};

export function TweetBatchDialog<R extends TweetRunData>({
  run,
  open,
  focusTweetIndex,
  onFocusTweetIndexChange,
  onClose,
  onUpdate,
  actions,
  brand,
}: Props<R>) {
  const [editedTweets, setEditedTweets] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (run) setEditedTweets(run.tweets);
  }, [run]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !run) return null;

  const isBatchMode = focusTweetIndex === null;
  const totalTweets = editedTweets.length;
  const safeIndex =
    focusTweetIndex !== null && focusTweetIndex >= 0 && focusTweetIndex < totalTweets
      ? focusTweetIndex
      : null;
  const currentTweet = safeIndex !== null ? editedTweets[safeIndex] : "";
  const currentStatus = safeIndex !== null ? effectiveTweetStatus(run, safeIndex) : "drafted";
  const charCount = currentTweet.length;
  const overLimit = charCount > 280;
  const hasUnsavedEdits =
    editedTweets.length !== run.tweets.length ||
    editedTweets.some((t, i) => t !== run.tweets[i]);

  const updateCurrent = (value: string) => {
    if (safeIndex === null) return;
    const next = [...editedTweets];
    next[safeIndex] = value;
    setEditedTweets(next);
  };

  const handleImageUploaded = (value: string) => {
    if (safeIndex === null) return;
    const next = [...editedTweets];
    next[safeIndex] = value;
    setEditedTweets(next);
    // Auto-persist after upload — losing an uploaded image would be costly.
    startTransition(async () => {
      const result = await actions.updateRunTweets(run.id, next);
      if (result.ok) onUpdate({ id: run.id, tweets: next });
    });
  };

  const updateAt = (idx: number, value: string) => {
    const next = [...editedTweets];
    next[idx] = value;
    setEditedTweets(next);
  };

  const handleSave = () => {
    startTransition(async () => {
      const result = await actions.updateRunTweets(run.id, editedTweets);
      if (result.ok) onUpdate({ id: run.id, tweets: editedTweets });
    });
  };

  const handleDiscard = () => setEditedTweets(run.tweets);

  const handleTransition = (next: TweetStatus) => {
    if (safeIndex === null) return;
    startTransition(async () => {
      const result = await actions.setTweetState(run.id, safeIndex, next);
      if (result.ok && result.tweetStates) {
        onUpdate({ id: run.id, tweetStates: result.tweetStates });
      }
    });
  };

  const handlePublish = async (
    platform: Platform,
  ): Promise<{ ok: boolean; url?: string; error?: string; note?: string }> => {
    if (safeIndex === null) return { ok: false, error: "no tweet selected" };
    if (hasUnsavedEdits) {
      const saved = await actions.updateRunTweets(run.id, editedTweets);
      if (!saved.ok) return { ok: false, error: saved.error ?? "Failed to save edits" };
      onUpdate({ id: run.id, tweets: editedTweets });
    }
    let result;
    let note: string | undefined;
    if (platform === "x") {
      const body = editedTweets[safeIndex];
      const { cleanText, imageUrl } = extractFirstMarkdownImage(body);
      if (imageUrl) {
        const { copied } = await copyImageOrOpen(imageUrl);
        note = copied
          ? "Image copied — paste with ⌘V / Ctrl+V into X"
          : "Image opened in a new tab — drop it onto X manually";
      }
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(cleanText)}`;
      window.open(intentUrl, "_blank", "noopener");
      result = await actions.recordXPublish(run.id, safeIndex);
    } else if (platform === "hive") {
      result = await actions.publishTweetToHive(run.id, safeIndex);
    } else if (platform === "farcaster") {
      result = await actions.publishTweetToFarcaster(run.id, safeIndex);
    } else {
      result = await actions.publishTweetToBinance(run.id, safeIndex);
    }
    if (result.ok && result.tweetStates) {
      onUpdate({ id: run.id, tweetStates: result.tweetStates });
    }
    const url = "url" in result && typeof result.url === "string" ? result.url : undefined;
    return { ok: result.ok, url, error: result.error, note };
  };

  const handleSchedule = async (
    platform: SchedulablePlatform,
    whenISO: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (safeIndex === null) return { ok: false, error: "no tweet selected" };
    if (hasUnsavedEdits) {
      const saved = await actions.updateRunTweets(run.id, editedTweets);
      if (!saved.ok) return { ok: false, error: saved.error ?? "Failed to save edits" };
      onUpdate({ id: run.id, tweets: editedTweets });
    }
    const result = await actions.scheduleTweetPublish(run.id, safeIndex, platform, whenISO);
    if (result.ok && result.tweetStates) {
      onUpdate({ id: run.id, tweetStates: result.tweetStates });
    }
    return { ok: result.ok, error: result.error };
  };

  const handleCancelSchedule = async (
    platform: SchedulablePlatform,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (safeIndex === null) return { ok: false, error: "no tweet selected" };
    const result = await actions.cancelScheduledTweet(run.id, safeIndex, platform);
    if (result.ok && result.tweetStates) {
      onUpdate({ id: run.id, tweetStates: result.tweetStates });
    }
    return { ok: result.ok, error: result.error };
  };

  const handleDeleteRun = () => {
    if (!confirm("Delete this entire run?")) return;
    startTransition(async () => {
      const result = await actions.deleteRun(run.id);
      if (result.ok) {
        onUpdate({ id: run.id });
        onClose();
      }
    });
  };

  const handleDeleteTweet = (idx: number) => {
    if (!confirm("Delete this tweet?")) return;
    const next = editedTweets.filter((_, i) => i !== idx);
    setEditedTweets(next);
    startTransition(async () => {
      const result = await actions.updateRunTweets(run.id, next);
      if (result.ok) {
        onUpdate({ id: run.id, tweets: next });
        if (safeIndex !== null && safeIndex >= next.length) {
          onFocusTweetIndexChange(next.length > 0 ? next.length - 1 : null);
        }
      }
    });
  };

  const goPrev = () => safeIndex !== null && safeIndex > 0 && onFocusTweetIndexChange(safeIndex - 1);
  const goNext = () =>
    safeIndex !== null && safeIndex < totalTweets - 1 && onFocusTweetIndexChange(safeIndex + 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 border-b border-border bg-background px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                {isBatchMode ? "Tweet batch" : `Tweet ${(safeIndex ?? 0) + 1} of ${totalTweets}`}
              </h2>
              <p className="mt-1 truncate text-xs text-foreground-subtle">{run.inputSummary ?? "—"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-foreground-muted">
                  status: {run.status}
                </span>
                {run.jobStatus && (
                  <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-foreground-muted">
                    job: {run.jobStatus}
                  </span>
                )}
                <span className="text-foreground-subtle">started {new Date(run.startedAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isBatchMode && totalTweets > 1 && (
                <button
                  type="button"
                  onClick={() => onFocusTweetIndexChange(null)}
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-foreground-muted hover:bg-foreground/5"
                >
                  Show all ({totalTweets})
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-foreground-subtle hover:bg-foreground/5 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {run.error && (
            <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/5 px-4 py-2 text-sm text-red-300">
              {run.error}
            </div>
          )}

          {totalTweets === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-elevated p-8 text-center text-sm text-foreground-subtle">
              No tweets generated for this run.
            </div>
          ) : isBatchMode ? (
            <BatchTweetList
              tweets={editedTweets}
              run={run}
              onChange={updateAt}
              onDelete={handleDeleteTweet}
              onSelect={(idx) => onFocusTweetIndexChange(idx)}
            />
          ) : (
            <SingleTweetView
              tweet={currentTweet}
              brand={brand}
              status={currentStatus}
              charCount={charCount}
              overLimit={overLimit}
              published={run.tweetStates?.[String(safeIndex)]?.publishedTo ?? {}}
              scheduled={run.tweetStates?.[String(safeIndex)]?.scheduledFor ?? {}}
              isPublishing={pending}
              hasUnsavedEdits={hasUnsavedEdits}
              onPublish={handlePublish}
              onSchedule={handleSchedule}
              onCancelSchedule={handleCancelSchedule}
              onChange={updateCurrent}
              onImageUploaded={handleImageUploaded}
              uploadImage={actions.uploadDraftImage}
              onDelete={() => safeIndex !== null && handleDeleteTweet(safeIndex)}
              onPrev={goPrev}
              onNext={goNext}
              canPrev={safeIndex !== null && safeIndex > 0}
              canNext={safeIndex !== null && safeIndex < totalTweets - 1}
              indexLabel={`${(safeIndex ?? 0) + 1} / ${totalTweets}`}
            />
          )}
        </div>

        {hasUnsavedEdits && (
          <div className="border-t border-amber-400/20 bg-amber-400/5 px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-amber-200">You have unsaved edits.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-foreground-muted hover:bg-foreground/5"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending}
                  className="rounded-lg border border-accent-border bg-accent-bg px-3 py-1 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-background px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {!isBatchMode &&
              TRANSITIONS[currentStatus].map(({ next, label, tone }) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => handleTransition(next)}
                  disabled={pending || hasUnsavedEdits}
                  title={hasUnsavedEdits ? "Save edits first" : undefined}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${TONE_CLASS[tone]}`}
                >
                  {label}
                </button>
              ))}
          </div>
          <button
            type="button"
            onClick={handleDeleteRun}
            disabled={pending}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            Delete run
          </button>
        </footer>
      </div>
    </div>
  );
}

function BatchTweetList({
  tweets,
  run,
  onChange,
  onDelete,
  onSelect,
}: {
  tweets: string[];
  run: TweetRunData;
  onChange: (idx: number, value: string) => void;
  onDelete: (idx: number) => void;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
        Drafts ({tweets.length})
      </p>
      {tweets.map((tweet, idx) => {
        const status = effectiveTweetStatus(run, idx);
        const overLimit = tweet.length > 280;
        return (
          <div key={idx} className="rounded-xl border border-border bg-surface-elevated p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelect(idx)}
                className="text-[10px] uppercase tracking-widest text-foreground-subtle hover:text-foreground-muted"
              >
                Tweet {idx + 1}
              </button>
              <div className="flex items-center gap-2">
                <span className={overLimit ? "text-[10px] text-red-400" : "text-[10px] text-foreground-subtle"}>
                  {tweet.length}/280
                </span>
                {status !== "drafted" && (
                  <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground-muted">
                    {status}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(idx)}
                  className="text-foreground-subtle hover:text-red-400"
                  aria-label="Delete tweet"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <textarea
              value={tweet}
              onChange={(e) => onChange(idx, e.target.value)}
              rows={3}
              className="w-full resize-none bg-transparent text-sm text-foreground outline-none"
            />
          </div>
        );
      })}
    </div>
  );
}

const URL_REGEX = /(https?:\/\/[^\s)]+[^\s.,;:!?)])/g;

function renderTweetBody(text: string) {
  const out: (string | { url: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_REGEX)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push({ url: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((part, i) =>
    typeof part === "string" ? (
      <span key={i}>{part}</span>
    ) : (
      <span key={i} className="text-[#1d9bf0] hover:underline">{part.url}</span>
    ),
  );
}

const PLATFORM_META: Record<
  Platform,
  { label: string; color: string; border: string; hover: string }
> = {
  x: {
    label: "X",
    color: "text-foreground",
    border: "border-zinc-400/30",
    hover: "hover:bg-zinc-400/10",
  },
  hive: {
    label: "Hive",
    color: "text-red-300",
    border: "border-red-400/30",
    hover: "hover:bg-red-400/10",
  },
  farcaster: {
    label: "Farcaster",
    color: "text-purple-300",
    border: "border-purple-400/30",
    hover: "hover:bg-purple-400/10",
  },
  binance: {
    label: "Binance",
    color: "text-yellow-300",
    border: "border-yellow-400/30",
    hover: "hover:bg-yellow-400/10",
  },
};

type StepStatus = "idle" | "queued" | "running" | "done" | "failed";

const PLATFORM_LIMITS: Record<Platform, number> = {
  hive: Infinity,
  farcaster: 320,
  x: 280,
  binance: Infinity,
};

function PublishRow({
  published,
  scheduled,
  isPublishing,
  charCount,
  onPublish,
  onSchedule,
  onCancelSchedule,
}: {
  published: Partial<Record<Platform, { at: string; url?: string; ref?: string }>>;
  scheduled: Partial<Record<SchedulablePlatform, string>>;
  isPublishing: boolean;
  charCount: number;
  onPublish: (
    platform: Platform,
  ) => Promise<{ ok: boolean; url?: string; error?: string; note?: string }>;
  onSchedule: (
    platform: SchedulablePlatform,
    whenISO: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onCancelSchedule: (
    platform: SchedulablePlatform,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [steps, setSteps] = useState<Record<Platform, StepStatus>>({
    hive: published.hive ? "done" : "idle",
    farcaster: published.farcaster ? "done" : "idle",
    x: published.x ? "done" : "idle",
    binance: published.binance ? "done" : "idle",
  });
  const [errors, setErrors] = useState<Partial<Record<Platform, string>>>({});
  const [notes, setNotes] = useState<Partial<Record<Platform, string>>>({});
  const [running, setRunning] = useState(false);
  const [schedulingPlatforms, setSchedulingPlatforms] = useState<SchedulablePlatform[]>([]);
  const [scheduleValue, setScheduleValue] = useState<string>("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  // Keep steps in sync when persisted state changes (e.g. parent re-render after save)
  useEffect(() => {
    setSteps((prev) => ({
      hive: published.hive ? "done" : prev.hive === "done" ? "idle" : prev.hive,
      farcaster: published.farcaster
        ? "done"
        : prev.farcaster === "done"
          ? "idle"
          : prev.farcaster,
      x: published.x ? "done" : prev.x === "done" ? "idle" : prev.x,
      binance: published.binance ? "done" : prev.binance === "done" ? "idle" : prev.binance,
    }));
  }, [published.hive, published.farcaster, published.x, published.binance]);

  const baseBlocked = isPublishing || running;
  const blockedFor = (p: Platform) => baseBlocked || charCount > PLATFORM_LIMITS[p];
  const reasonFor = (p: Platform) => {
    if (charCount > PLATFORM_LIMITS[p]) return `Over ${PLATFORM_LIMITS[p]} characters`;
    return undefined;
  };
  const allOver = (Object.keys(PLATFORM_LIMITS) as Platform[]).every(
    (p) => charCount > PLATFORM_LIMITS[p],
  );
  const splitBlocked = baseBlocked || allOver;
  const splitBlockedReason = allOver ? "Over character limit on every platform" : undefined;

  const stepperVisible =
    steps.hive !== "idle" ||
    steps.farcaster !== "idle" ||
    steps.x !== "idle" ||
    steps.binance !== "idle" ||
    !!scheduled.hive ||
    !!scheduled.farcaster ||
    !!scheduled.binance;

  const openScheduler = (p: SchedulablePlatform) => {
    const existing = scheduled[p];
    const seed = existing ? new Date(existing) : new Date(Date.now() + 60 * 60 * 1000);
    setSchedulingPlatforms([p]);
    setScheduleValue(toDatetimeLocalValue(seed));
    setScheduleError(null);
  };

  const submitSchedule = async () => {
    if (schedulingPlatforms.length === 0 || !scheduleValue) return;
    const when = new Date(scheduleValue);
    if (Number.isNaN(when.getTime())) {
      setScheduleError("Invalid date");
      return;
    }
    setScheduleSubmitting(true);
    const whenISO = when.toISOString();
    for (const platform of schedulingPlatforms) {
      const result = await onSchedule(platform, whenISO);
      if (!result.ok) {
        setScheduleSubmitting(false);
        setScheduleError(result.error ?? `Failed to schedule ${platform}`);
        return;
      }
    }
    setScheduleSubmitting(false);
    setSchedulingPlatforms([]);
    setScheduleError(null);
  };

  const cancelSchedule = async (p: SchedulablePlatform) => {
    setRunning(true);
    await onCancelSchedule(p);
    setRunning(false);
  };

  const runPlatform = async (p: Platform) => {
    setSteps((s) => ({ ...s, [p]: "running" }));
    setErrors((e) => ({ ...e, [p]: undefined }));
    setNotes((n) => ({ ...n, [p]: undefined }));
    const result = await onPublish(p);
    if (result.ok) {
      setSteps((s) => ({ ...s, [p]: "done" }));
      if (result.note) setNotes((n) => ({ ...n, [p]: result.note }));
    } else {
      setSteps((s) => ({ ...s, [p]: "failed" }));
      setErrors((e) => ({ ...e, [p]: result.error ?? "unknown error" }));
    }
    return result.ok;
  };

  const handlePostToAll = async () => {
    setRunning(true);
    setSteps({
      hive: steps.hive === "done" ? "done" : "running",
      farcaster: steps.farcaster === "done" ? "done" : "queued",
      binance: steps.binance === "done" ? "done" : "queued",
      x: steps.x === "done" ? "done" : "queued",
    });
    if (steps.hive !== "done") {
      await runPlatform("hive");
    }
    if (steps.farcaster !== "done") {
      // mark running explicitly (queued → running)
      setSteps((s) => ({ ...s, farcaster: "running" }));
      await runPlatform("farcaster");
    }
    if (steps.binance !== "done") {
      // mark running explicitly (queued → running)
      setSteps((s) => ({ ...s, binance: "running" }));
      await runPlatform("binance");
    }
    // x stays queued until user clicks
    setRunning(false);
  };

  const handleX = async () => {
    if (blockedFor("x")) return;
    setRunning(true);
    await runPlatform("x");
    setRunning(false);
  };

  if (!stepperVisible) {
    return (
      <section>
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
          Publish to
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <PostToAllSplitButton
            running={running}
            blocked={splitBlocked}
            blockedReason={splitBlockedReason}
            onPostToAll={handlePostToAll}
            onPostIndividual={async (p) => {
              setRunning(true);
              await runPlatform(p);
              setRunning(false);
            }}
          />
          <button
            type="button"
            onClick={() => openScheduler("hive")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-foreground/5 px-3 py-1.5 text-xs text-foreground-muted hover:bg-foreground/10"
          >
            <Clock className="h-3.5 w-3.5" />
            Schedule
          </button>
        </div>
        <p className="mt-2 text-[11px] text-foreground-subtle">
          Posts to Hive, Farcaster and Binance automatically, then opens X with the tweet pre-filled.
        </p>
        {schedulingPlatforms.length > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-surface/50 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <label className="block text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
                  Schedule publish to
                </label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["hive", "farcaster", "binance"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setSchedulingPlatforms((prev) =>
                          prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
                        )
                      }
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                        schedulingPlatforms.includes(p)
                          ? "border-accent-border bg-accent-bg text-accent"
                          : "border-border bg-foreground/5 text-foreground-muted hover:bg-foreground/10"
                      }`}
                    >
                      {p === "hive" ? "Hive" : p === "farcaster" ? "Farcaster" : "Binance"}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSchedulingPlatforms(["hive", "farcaster", "binance"])}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                      schedulingPlatforms.length === 3
                        ? "border-accent-border bg-accent-bg text-accent"
                        : "border-border bg-foreground/5 text-foreground-muted hover:bg-foreground/10"
                    }`}
                  >
                    All
                  </button>
                </div>
                <input
                  type="datetime-local"
                  value={scheduleValue}
                  min={toDatetimeLocalValue(new Date())}
                  onChange={(e) => setScheduleValue(e.target.value)}
                  className="mt-2 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent-border"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submitSchedule}
                  disabled={scheduleSubmitting || !scheduleValue || schedulingPlatforms.length === 0}
                  className="rounded-md border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  {scheduleSubmitting ? "Saving…" : "Schedule"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSchedulingPlatforms([]);
                    setScheduleError(null);
                  }}
                  className="rounded-md border border-border bg-foreground/5 px-3 py-1.5 text-xs text-foreground-muted hover:bg-foreground/10"
                >
                  Cancel
                </button>
              </div>
            </div>
            {scheduleError && (
              <p className="mt-2 text-[11px] text-red-300">{scheduleError}</p>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section>
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">Publishing</p>
      <div className="flex items-stretch gap-2">
        <StepBox
          platform="hive"
          status={steps.hive}
          rec={published.hive}
          scheduledAt={scheduled.hive}
          error={errors.hive}
          onRetry={() => runPlatform("hive")}
          onAction={() => runPlatform("hive")}
          onSchedule={() => openScheduler("hive")}
          onCancelSchedule={() => cancelSchedule("hive")}
          actionLabel="Post on Hive"
          blocked={blockedFor("hive")}
          blockedReason={reasonFor("hive")}
        />
        <StepConnector />
        <StepBox
          platform="farcaster"
          status={steps.farcaster}
          rec={published.farcaster}
          scheduledAt={scheduled.farcaster}
          error={errors.farcaster}
          onRetry={() => runPlatform("farcaster")}
          onAction={() => runPlatform("farcaster")}
          onSchedule={() => openScheduler("farcaster")}
          onCancelSchedule={() => cancelSchedule("farcaster")}
          actionLabel="Cast on Farcaster"
          blocked={blockedFor("farcaster")}
          blockedReason={reasonFor("farcaster")}
        />
        <StepConnector />
        <StepBox
          platform="binance"
          status={steps.binance}
          rec={published.binance}
          scheduledAt={scheduled.binance}
          error={errors.binance}
          onRetry={() => runPlatform("binance")}
          onAction={() => runPlatform("binance")}
          onSchedule={() => openScheduler("binance")}
          onCancelSchedule={() => cancelSchedule("binance")}
          actionLabel="Post on Binance"
          blocked={blockedFor("binance")}
          blockedReason={reasonFor("binance")}
        />
        <StepConnector />
        <StepBox
          platform="x"
          status={steps.x}
          rec={published.x}
          error={errors.x}
          note={notes.x}
          onAction={handleX}
          actionLabel="Post on X →"
          blocked={blockedFor("x")}
          blockedReason={reasonFor("x")}
        />
      </div>
      {schedulingPlatforms.length > 0 && (
        <div className="mt-3 rounded-xl border border-border bg-surface/50 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="block text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
                Schedule publish
              </label>
              <input
                type="datetime-local"
                value={scheduleValue}
                min={toDatetimeLocalValue(new Date())}
                onChange={(e) => setScheduleValue(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent-border"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitSchedule}
                disabled={scheduleSubmitting || !scheduleValue || schedulingPlatforms.length === 0}
                className="rounded-md border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {scheduleSubmitting ? "Saving…" : "Schedule"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSchedulingPlatforms([]);
                  setScheduleError(null);
                }}
                className="rounded-md border border-border bg-foreground/5 px-3 py-1.5 text-xs text-foreground-muted hover:bg-foreground/10"
              >
                Cancel
              </button>
            </div>
          </div>
          {scheduleError && (
            <p className="mt-2 text-[11px] text-red-300">{scheduleError}</p>
          )}
        </div>
      )}
    </section>
  );
}

function PostToAllSplitButton({
  running,
  blocked,
  blockedReason,
  onPostToAll,
  onPostIndividual,
}: {
  running: boolean;
  blocked: boolean;
  blockedReason?: string;
  onPostToAll: () => void;
  onPostIndividual: (p: Platform) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (p: Platform) => {
    setOpen(false);
    onPostIndividual(p);
  };

  const individual: {
    p: Platform;
    primary: string;
    secondary: string;
  }[] = [
    { p: "hive", primary: "Hive snap", secondary: "Post to hive-173115" },
    { p: "farcaster", primary: "Farcaster cast", secondary: "Cast in /skateboard" },
    { p: "binance", primary: "Binance post", secondary: "Post to Binance Square" },
    { p: "x", primary: "X compose", secondary: "Open intent in new tab" },
  ];

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onPostToAll}
        disabled={blocked}
        title={blockedReason}
        className="inline-flex items-center gap-2 rounded-l-xl border border-accent-border bg-accent-bg px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {running && <Loader2 className="h-4 w-4 animate-spin" />}
        Post to all
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={blocked}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose a platform"
        title={blockedReason ?? "Choose individual platform"}
        className="inline-flex items-center justify-center rounded-r-xl border border-l-0 border-accent-border bg-accent-bg px-2.5 py-2.5 text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+4px)] z-10 min-w-[240px] overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-lg"
        >
          {individual.map(({ p, primary, secondary }) => (
            <button
              key={p}
              role="menuitem"
              type="button"
              onClick={() => pick(p)}
              disabled={blocked}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-foreground/5 disabled:opacity-50"
            >
              <PlatformBadge platform={p} size={24} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{primary}</p>
                <p className="truncate text-[10px] text-foreground-subtle">{secondary}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformBadge({ platform, size = 20 }: { platform: Platform; size?: number }) {
  // X — black square with white slash
  if (platform === "x") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="shrink-0 rounded-md bg-black p-1"
        aria-hidden
      >
        <path
          fill="#ffffff"
          d="M18.244 2H21.5l-7.5 8.57L23 22h-6.78l-5.31-6.95L4.8 22H1.54l8.04-9.18L1 2h6.92l4.79 6.32L18.244 2Zm-2.38 18.18h1.88L7.22 3.74H5.2l10.66 16.44Z"
        />
      </svg>
    );
  }
  // Hive — red rounded square with "H"
  if (platform === "hive") {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-md bg-red-500 font-bold text-white"
      >
        <svg viewBox="0 0 24 24" width={size * 0.7} height={size * 0.7} aria-hidden>
          <path
            fill="#ffffff"
            d="M7.5 3 3 11.5 7.5 20l2-3.5-3-5 3-5L7.5 3Zm9 0L14 7l3 4.5-3 4.5 2.5 4 5-8.5L16.5 3Z"
          />
        </svg>
      </div>
    );
  }
  // Binance — Binance-gold rounded square with white "B"
  if (platform === "binance") {
    return (
      <div
        style={{ width: size, height: size, backgroundColor: "#F0B90B" }}
        className="flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      >
        <svg viewBox="0 0 24 24" width={size * 0.65} height={size * 0.65} aria-hidden>
          <path
            fill="#ffffff"
            d="M12 2L7 7l2 2 3-3 3 3 2-2L12 2zm-5 5L2 12l2 2 3-3v6l3 3 3-3v-6l3 3 2-2-5-5zm10 0l-5 5 2 2 3-3v6l-3 3-3-3v-6l-3 3 2 2 3-3 3 3 3-3V7h-2zM12 15l-3 3 3 3 3-3-3-3z"
          />
        </svg>
      </div>
    );
  }
  // Farcaster — purple rounded square with arch glyph
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-md bg-[#855dcd]"
    >
      <svg viewBox="0 0 32 29" width={size * 0.7} height={size * 0.7} aria-hidden>
        <path
          fill="#ffffff"
          d="M5.5 0h21v29H22v-8.7c0-3.4-2.7-6.2-6-6.2s-6 2.8-6 6.2V29H5.5V0Z"
        />
        <path fill="#ffffff" d="M0 4h4l1 4H1L0 4Zm27 0h4l1 4h-4l-1-4Z" />
      </svg>
    </div>
  );
}

function StepConnector() {
  return (
    <div className="flex items-center" aria-hidden>
      <div className="h-px w-4 bg-white/10" />
    </div>
  );
}

function StepBox({
  platform,
  status,
  rec,
  scheduledAt,
  error,
  note,
  onRetry,
  onAction,
  onSchedule,
  onCancelSchedule,
  actionLabel,
  blocked,
  blockedReason,
}: {
  platform: Platform;
  status: StepStatus;
  rec?: { at: string; url?: string; ref?: string };
  scheduledAt?: string;
  error?: string;
  note?: string;
  onRetry?: () => void;
  onAction?: () => void;
  onSchedule?: () => void;
  onCancelSchedule?: () => void;
  actionLabel?: string;
  blocked: boolean;
  blockedReason?: string;
}) {
  const meta = PLATFORM_META[platform];
  const isScheduled = status === "idle" && !!scheduledAt;
  const isAction =
    (status === "idle" && !scheduledAt && !!onAction) ||
    (platform === "x" && status === "queued");

  const indicator = () => {
    if (status === "done") return <span className="text-emerald-400">✓</span>;
    if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    if (status === "failed") return <span className="text-red-400">✗</span>;
    if (status === "queued") return <span className="text-foreground-subtle">⋯</span>;
    if (isScheduled) return <Clock className="h-3.5 w-3.5 text-amber-300" />;
    return <span className="text-foreground-faint">○</span>;
  };

  return (
    <div
      className={`min-w-[140px] flex-1 rounded-xl border ${
        status === "done"
          ? "border-emerald-400/30 bg-emerald-400/[0.04]"
          : status === "failed"
            ? "border-red-400/30 bg-red-400/[0.04]"
            : status === "running"
              ? `${meta.border} bg-surface/70`
              : isScheduled
                ? "border-amber-400/30 bg-amber-400/[0.04]"
                : "border-border bg-surface/50"
      } px-3 py-2.5`}
    >
      <div className={`flex items-center gap-2 text-xs font-medium ${meta.color}`}>
        {indicator()}
        <span>{meta.label}</span>
      </div>
      <div className="mt-1.5 text-[11px] leading-relaxed">
        {status === "done" && rec?.url && (
          <a
            href={rec.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground-muted underline hover:text-foreground"
          >
            view post
          </a>
        )}
        {status === "done" && !rec?.url && <span className="text-foreground-subtle">posted</span>}
        {status === "running" && <span className="text-foreground-subtle">posting…</span>}
        {status === "queued" && !isAction && <span className="text-foreground-subtle">waiting</span>}
        {isScheduled && (
          <div className="space-y-1">
            <p className="text-amber-200">for {formatScheduledFor(scheduledAt!)}</p>
            <div className="flex gap-1.5">
              {onSchedule && (
                <button
                  type="button"
                  onClick={onSchedule}
                  disabled={blocked}
                  className="text-[10px] uppercase tracking-wider text-amber-200 underline disabled:opacity-30"
                >
                  edit
                </button>
              )}
              {onCancelSchedule && (
                <button
                  type="button"
                  onClick={onCancelSchedule}
                  disabled={blocked}
                  className="text-[10px] uppercase tracking-wider text-foreground-muted underline disabled:opacity-30"
                >
                  cancel
                </button>
              )}
            </div>
          </div>
        )}
        {status === "failed" && (
          <div className="space-y-1">
            <p className="text-red-300/90">{error?.slice(0, 80) ?? "failed"}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={blocked}
                className="text-[10px] uppercase tracking-wider text-red-300 underline disabled:opacity-30"
              >
                retry
              </button>
            )}
          </div>
        )}
        {isAction && onAction && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onAction}
              disabled={blocked}
              title={blockedReason}
              className="rounded-md border border-border bg-foreground/5 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-foreground/10 disabled:opacity-50"
            >
              {actionLabel}
            </button>
            {onSchedule && (
              <button
                type="button"
                onClick={onSchedule}
                disabled={blocked}
                title={blockedReason}
                aria-label="Schedule"
                className="rounded-md border border-border bg-foreground/5 p-1.5 text-foreground-muted hover:bg-foreground/10 disabled:opacity-50"
              >
                <Clock className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {note && (
          <p className="mt-1 text-[10px] leading-snug text-foreground-muted">{note}</p>
        )}
      </div>
    </div>
  );
}

function TweetPreview({ tweet, brand }: { tweet: string; brand: TweetBrand }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
      <div className="flex items-start gap-3">
        <Image
          src={brand.avatarUrl}
          alt={brand.name}
          width={40}
          height={40}
          className="shrink-0 rounded-full"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1 text-[15px] leading-tight">
            <span className="font-bold text-foreground">{brand.name}</span>
            <span className="text-foreground-subtle">{brand.handle}</span>
            <span className="text-foreground-subtle">·</span>
            <span className="text-foreground-subtle">now</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug text-foreground">
            {renderTweetBody(tweet)}
          </p>
          <div className="mt-3 flex max-w-md items-center justify-between text-foreground-subtle">
            <button
              type="button"
              className="group flex items-center gap-1.5 text-xs transition hover:text-[#1d9bf0]"
              aria-label="Reply"
            >
              <span className="rounded-full p-1.5 group-hover:bg-[#1d9bf0]/10">
                <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
            </button>
            <button
              type="button"
              className="group flex items-center gap-1.5 text-xs transition hover:text-[#00ba7c]"
              aria-label="Repost"
            >
              <span className="rounded-full p-1.5 group-hover:bg-[#00ba7c]/10">
                <Repeat2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
            </button>
            <button
              type="button"
              className="group flex items-center gap-1.5 text-xs transition hover:text-[#f91880]"
              aria-label="Like"
            >
              <span className="rounded-full p-1.5 group-hover:bg-[#f91880]/10">
                <Heart className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
            </button>
            <button
              type="button"
              className="group flex items-center gap-1.5 text-xs transition hover:text-[#1d9bf0]"
              aria-label="Views"
            >
              <span className="rounded-full p-1.5 group-hover:bg-[#1d9bf0]/10">
                <BarChart3 className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-full p-1.5 transition hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0]"
                aria-label="Bookmark"
              >
                <Bookmark className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="rounded-full p-1.5 transition hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0]"
                aria-label="Share"
              >
                <Share className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SingleTweetView({
  tweet,
  brand,
  status,
  charCount,
  overLimit,
  published,
  scheduled,
  isPublishing,
  hasUnsavedEdits,
  onPublish,
  onSchedule,
  onCancelSchedule,
  onChange,
  onImageUploaded,
  onDelete,
  onPrev,
  onNext,
  canPrev,
  canNext,
  indexLabel,
  uploadImage,
}: {
  tweet: string;
  brand: TweetBrand;
  status: TweetStatus;
  charCount: number;
  overLimit: boolean;
  published: Partial<Record<Platform, { at: string; url?: string; ref?: string }>>;
  scheduled: Partial<Record<SchedulablePlatform, string>>;
  isPublishing: boolean;
  hasUnsavedEdits: boolean;
  onPublish: (
    platform: Platform,
  ) => Promise<{ ok: boolean; url?: string; error?: string; note?: string }>;
  onSchedule: (
    platform: SchedulablePlatform,
    whenISO: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onCancelSchedule: (
    platform: SchedulablePlatform,
  ) => Promise<{ ok: boolean; error?: string }>;
  onChange: (v: string) => void;
  onImageUploaded: (v: string) => void;
  onDelete: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  indexLabel: string;
  uploadImage: TweetBatchActions["uploadDraftImage"];
}) {
  const copy = () => navigator.clipboard.writeText(tweet);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file) return;
    setImgError(null);
    setImgUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadImage(fd);
      if (!result.ok || !result.url) {
        setImgError(result.error ?? "Upload failed");
        return;
      }
      // Append markdown image to body. Hive renders as image, Farcaster
      // gets it as an embed, X just sees a URL.
      const prefix = tweet.endsWith("\n") || tweet === "" ? "" : "\n\n";
      onImageUploaded(`${tweet}${prefix}![](${result.url})`);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : String(err));
    } finally {
      setImgUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">Preview</p>
        <TweetPreview tweet={tweet} brand={brand} />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">Edit</p>
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] text-foreground-muted">
            {status}
          </span>
        </div>
        <textarea
          value={tweet}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent-border"
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className={overLimit ? "text-red-400" : "text-foreground-subtle"}>
            {charCount}/280
          </span>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPickImage}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={imgUploading}
              className="inline-flex items-center gap-1 rounded-lg border border-accent-border bg-accent-bg px-2 py-1 text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              {imgUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {imgUploading ? "Uploading…" : "Add image"}
            </button>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-foreground-muted hover:bg-foreground/5"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-red-500/20 px-2 py-1 text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
        {imgError && (
          <p className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
            {imgError}
          </p>
        )}
      </section>

      <PublishRow
        published={published}
        scheduled={scheduled}
        isPublishing={isPublishing}
        charCount={charCount}
        onPublish={onPublish}
        onSchedule={onSchedule}
        onCancelSchedule={onCancelSchedule}
      />

      {(canPrev || canNext) && (
        <nav className="flex items-center justify-between rounded-xl border border-border bg-surface/50 px-3 py-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <span className="text-xs text-foreground-subtle">{indexLabel}</span>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground disabled:opacity-30"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
}
