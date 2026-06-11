"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { MessageSquarePlus, Loader2, X, Trash2, RefreshCw, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  listInsightFeedback,
  addInsightFeedback,
  removeInsightFeedback,
} from "@/app/actions/insight-feedback";
import { regenerateBriefing } from "@/app/actions/briefings";
import type { FeedbackKind, FeedbackNote } from "@/lib/insight-feedback";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * "Feedback" button for any AI insight / morning-briefing panel. Lets the team
 * leave free-text corrections that get injected into the panel's prompt on the
 * NEXT generation. `kind` + `channelKey` resolve the canonical scope server-side
 * (the project is taken from the authenticated request).
 */
export function FeedbackButton({
  kind,
  channelKey,
  label = "this panel",
}: {
  kind: FeedbackKind;
  /** platform (social) or agent slug (briefing); omit for analytics */
  channelKey?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<FeedbackNote[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [regen, setRegen] = useState<"idle" | "busy" | "done" | "error">("idle");
  const router = useRouter();

  // Briefings can be regenerated straight from this dialog so corrections take
  // effect immediately instead of silently waiting for the next manual run.
  const canRegenerate = kind === "briefing" && !!channelKey;

  async function applyNow() {
    if (!canRegenerate || regen === "busy") return;
    setRegen("busy");
    const r = await regenerateBriefing(channelKey!);
    if (r.ok) {
      setRegen("done");
      router.refresh();
    } else {
      setRegen("error");
      setError(r.error ?? "Regeneration failed");
    }
  }

  // Lazily fetch the count once so the badge reflects existing feedback.
  useEffect(() => {
    let cancelled = false;
    listInsightFeedback(kind, channelKey)
      .then((n) => !cancelled && setCount(n.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, channelKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const n = await listInsightFeedback(kind, channelKey);
      setNotes(n);
      setCount(n.length);
    } finally {
      setLoading(false);
    }
  }, [kind, channelKey]);

  function openDialog() {
    setOpen(true);
    setError(null);
    void refresh();
  }

  function submit() {
    const note = draft.trim();
    if (!note) return;
    setError(null);
    startTransition(async () => {
      const r = await addInsightFeedback(kind, channelKey, note);
      if (r.ok) {
        setNotes(r.notes);
        setCount(r.notes.length);
        setDraft("");
      } else {
        setError(r.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await removeInsightFeedback(id, kind, channelKey);
      if (r.ok) {
        setNotes(r.notes);
        setCount(r.notes.length);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-foreground/5 px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:bg-foreground/10 hover:text-foreground"
        title="Leave a correction the agent will honor next time"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Feedback
        {count ? (
          <span className="ml-0.5 rounded-full bg-accent-bg px-1.5 py-px text-[10px] font-semibold text-accent">
            {count}
          </span>
        ) : null}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">Feedback</h2>
                <p className="mt-0.5 text-xs text-foreground-subtle">
                  Corrections for <span className="font-medium text-foreground-muted">{label}</span> — applied the next time it&apos;s generated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-foreground-subtle hover:bg-foreground/5 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={3}
                placeholder="e.g. The lowest-performing post was made 50min ago after 3 months of silence — don't treat a brand-new post as an underperformer."
                className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-faint focus:ring-1 focus:ring-accent-border"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-foreground-faint">⌘/Ctrl + Enter to save</span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Add correction
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-danger">{error}</p>}

              {canRegenerate && notes.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-accent-border bg-accent-bg px-3 py-2.5">
                  <p className="text-xs text-foreground-muted">
                    {regen === "done"
                      ? "Briefing regenerated with the corrections applied."
                      : "Corrections only take effect on the next generation."}
                  </p>
                  <button
                    type="button"
                    onClick={applyNow}
                    disabled={regen === "busy" || regen === "done"}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-60"
                  >
                    {regen === "busy" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : regen === "done" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {regen === "busy" ? "Regenerating…" : regen === "done" ? "Done" : "Apply now — regenerate"}
                  </button>
                </div>
              )}

              <div className="mt-5 border-t border-border pt-4">
                <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
                  Saved corrections
                </p>
                {loading ? (
                  <div className="flex items-center gap-2 py-4 text-foreground-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                ) : notes.length === 0 ? (
                  <p className="py-3 text-xs italic text-foreground-subtle">
                    No corrections yet. The first one you add steers the next generation.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {notes.map((n) => (
                      <li
                        key={n.id}
                        className="group flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{n.note}</p>
                          <p className="mt-1 text-[10px] text-foreground-faint">
                            {n.createdBy ? `@${n.createdBy} · ` : ""}
                            {relativeTime(n.createdAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(n.id)}
                          disabled={pending}
                          aria-label="Delete correction"
                          className="shrink-0 rounded p-1 text-foreground-faint opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
