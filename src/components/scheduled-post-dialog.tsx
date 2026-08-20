"use client";

// Preview + edit dialog for scheduled suggestion/repo posts, opened from the
// calendars. Reschedule or cancel right here; full text editing lives on the
// source page (linked).

import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Loader2, Trash2, X } from "lucide-react";
import type { CalendarExtra } from "@/app/actions/post-creator";
import {
  scheduleMarketingTweetPublish,
  cancelScheduledMarketingTweet,
} from "@/app/actions/marketing-suggestions";
import {
  scheduleTweetPublish,
  cancelScheduledTweet,
} from "@/app/actions/repo-to-social";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { isForeign } from "@/lib/calendar-scope";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse `${kind}:${runId}:${idx}:${platform}` (suggestion/repo events). */
function parseEventId(e: CalendarExtra): { runId: string; tweetIndex: number; platform: string } | null {
  const parts = e.id.split(":");
  if (parts.length < 4) return null;
  const platform = parts[parts.length - 1];
  const idx = Number(parts[parts.length - 2]);
  const runId = parts.slice(1, -2).join(":");
  if (!runId || Number.isNaN(idx)) return null;
  return { runId, tweetIndex: idx, platform };
}

export function ScheduledPostDialog({
  event,
  activeSlug,
  onClose,
  onChanged,
}: {
  event: CalendarExtra;
  activeSlug: string;
  onClose: () => void;
  /** Called with the new ISO time, or null when the schedule was cancelled. */
  onChanged: (newWhen: string | null) => void;
}) {
  const parsed = parseEventId(event);
  const [when, setWhen] = useState(() => toLocalInput(new Date(event.when)));
  const [busy, setBusy] = useState<"save" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const editable = (event.kind === "suggestion" || event.kind === "repo") && !!parsed;
  const foreign = isForeign(event, activeSlug);
  const originName = event.projectName ?? event.projectSlug;
  const sourceHref =
    event.kind === "repo" ? "/marketing-suggestions?tab=repo" : "/marketing-suggestions";

  async function reschedule() {
    if (!parsed || busy) return;
    setBusy("save");
    setError(null);
    const iso = new Date(when).toISOString();
    const fn = event.kind === "repo" ? scheduleTweetPublish : scheduleMarketingTweetPublish;
    const r = await fn(parsed.runId, parsed.tweetIndex, parsed.platform as never, iso);
    setBusy(null);
    if (r.ok) {
      onChanged(iso);
      onClose();
    } else setError(r.error ?? "Reschedule failed");
  }

  async function cancelSchedule() {
    if (!parsed || busy) return;
    if (!window.confirm("Cancel this scheduled post?")) return;
    setBusy("cancel");
    setError(null);
    const fn = event.kind === "repo" ? cancelScheduledTweet : cancelScheduledMarketingTweet;
    const r = await fn(parsed.runId, parsed.tweetIndex, parsed.platform as never);
    setBusy(null);
    if (r.ok) {
      onChanged(null);
      onClose();
    } else setError(r.error ?? "Cancel failed");
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scheduled post"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <SocialBrandIcon platform={event.platform} className="h-4 w-4 shrink-0" />
            <span className="truncate">
              Scheduled {event.platform} post
              {foreign && (
                <span className="ml-1.5 rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  {originName}
                </span>
              )}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg border border-border p-1.5 text-foreground-muted hover:border-border-strong hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-surface px-3.5 py-3 text-sm leading-relaxed text-foreground">
          {event.title || "(no text)"}
        </p>

        {/* Calendars are scoped to one project, so this should never show. If it
            does, the feed leaked another project's post — say so plainly rather
            than let someone reschedule it thinking it is theirs. */}
        {foreign && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
            This post belongs to the {originName} portal — it publishes on {originName}&apos;s
            accounts, not this one. Open it there to change it.
          </p>
        )}

        {editable ? (
          <>
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Publish at
            </label>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void reschedule()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
              >
                {busy === "save" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="h-3.5 w-3.5" />
                )}
                Reschedule
              </button>
              <button
                type="button"
                onClick={() => void cancelSchedule()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                {busy === "cancel" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Cancel schedule
              </button>
              <a
                href={sourceHref}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground"
              >
                edit text on the source page
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-foreground-subtle">
            Scheduled on the {originName} portal — open it there to edit.
          </p>
        )}
      </div>
    </div>
  );
}
