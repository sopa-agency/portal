"use client";

import { useEffect, useRef, useState } from "react";
import { GitPullRequest, GitPullRequestDraft, ExternalLink, ChevronDown } from "lucide-react";
import type { OpenPullRequest } from "@/lib/github-project";
import { useT } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";

function relTime(iso: string, t: Dictionary["kanban"]["prs"]): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t.now;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return t.weeks(Math.floor(d / 7));
}

/**
 * Toggle beside the Kanban title that reveals the project's open pull requests
 * across its configured repos (independent of the board columns). Rendered into
 * the PageHeader `actions` slot; the list drops down anchored to the button.
 */
export function KanbanRepoPRs({ prs }: { prs: OpenPullRequest[] }) {
  const t = useT().kanban.prs;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t.toggle}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          open
            ? "border-accent-border bg-accent-bg text-accent"
            : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"
        }`}
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        PRs
        <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] tabular-nums text-foreground-muted">
          {prs.length}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Mounted whether or not it's open, so closing animates too — the list is
          already in props, so there's nothing extra to fetch or compute for it.
          `inert` keeps the hidden links out of tab order and off the a11y tree;
          .popover-panel's visibility step is what stops it hit-testing. */}
      <div
        className="popover-panel absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl"
        data-open={open}
        inert={!open}
      >
        {prs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-foreground-muted">{t.empty}</p>
        ) : (
          <ul className="space-y-0.5">
            {prs.map((pr) => (
              <li key={`${pr.repo}#${pr.number}`}>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface-elevated"
                >
                  {pr.draft ? (
                    <GitPullRequestDraft className="mt-0.5 h-4 w-4 shrink-0 text-foreground-faint" />
                  ) : (
                    <GitPullRequest className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-foreground">{pr.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-foreground-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-foreground-subtle">
                      <span className="truncate">{pr.repo}</span>
                      <span className="text-foreground-faint">#{pr.number}</span>
                      <span className="text-foreground-faint">· {pr.author}</span>
                      <span className="text-foreground-faint">· {relTime(pr.updatedAt, t)}</span>
                      {pr.draft && <span className="text-foreground-faint">· {t.draft}</span>}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
