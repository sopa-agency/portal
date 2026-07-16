"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GitPullRequest, CircleDot, FileText, ExternalLink } from "lucide-react";
import { FirePriority, DeadlineChip } from "@/components/card-indicators";
// Type-only import — erased at compile time, so the server-only guard in
// issue-index.ts never runs on the client.
import type { IssueRef } from "@/lib/issue-index";

const CARD_W = 320; // px — keep in sync with the style width below.

type Placement = { top: number; left: number; above: boolean };

function statusBadge(info: IssueRef): { label: string; cls: string } {
  if (info.type === "draft") return { label: "Rascunho", cls: "bg-foreground/10 text-foreground-muted" };
  if (info.merged) return { label: "Merged", cls: "bg-purple-500/15 text-purple-500 dark:text-purple-400" };
  if ((info.state ?? "").toUpperCase() === "CLOSED")
    return info.type === "pr"
      ? { label: "Fechado", cls: "bg-danger/15 text-danger" }
      : { label: "Concluído", cls: "bg-success/15 text-success" };
  return { label: "Aberto", cls: "bg-success/15 text-success" };
}

function TypeIcon({ type, className }: { type: IssueRef["type"]; className?: string }) {
  if (type === "pr") return <GitPullRequest className={className} />;
  if (type === "draft") return <FileText className={className} />;
  return <CircleDot className={className} />;
}

// Inline "#145" reference in briefing text that reveals the task's card on
// hover — title, board status, assignees, priority — floating via a portal so
// no overflow container clips it. Still a link: click opens it on GitHub.
export function IssueHoverCard({ info, children }: { info: IssueRef; children: React.ReactNode }) {
  const [place, setPlace] = useState<Placement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const open = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < 260 && r.top > spaceBelow;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8));
    setPlace({ top: above ? r.top - 6 : r.bottom + 6, left, above });
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPlace(null), 120);
  };

  const badge = statusBadge(info);

  return (
    <>
      <a
        ref={anchorRef}
        href={info.url}
        target="_blank"
        rel="noreferrer"
        onMouseEnter={open}
        onFocus={open}
        onMouseLeave={scheduleClose}
        onBlur={scheduleClose}
        className="cursor-pointer font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent/80"
      >
        {children}
      </a>

      {place &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: place.top,
              left: place.left,
              width: CARD_W,
              transform: place.above ? "translateY(-100%)" : undefined,
            }}
            className="z-[60] rounded-xl border border-border bg-surface p-3 text-left shadow-xl"
          >
            {/* Header: type · #num · status */}
            <div className="mb-1.5 flex items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 text-foreground-subtle">
                <TypeIcon type={info.type} className="h-3.5 w-3.5" />
                <span className="font-semibold">#{info.number}</span>
              </span>
              <span className={`rounded-full px-1.5 py-0.5 font-medium ${badge.cls}`}>{badge.label}</span>
              {info.column && (
                <span className="ml-auto truncate rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  {info.column}
                </span>
              )}
            </div>

            {/* Title */}
            <p className="line-clamp-3 text-[13px] font-medium leading-snug text-foreground">{info.title}</p>

            {/* Priority + deadline */}
            {(info.firePriority || info.deadline) && (
              <div className="mt-2 flex items-center gap-3">
                <FirePriority value={info.firePriority} />
                <DeadlineChip value={info.deadline} />
              </div>
            )}

            {/* Labels */}
            {info.labels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {info.labels.slice(0, 4).map((l) => (
                  <span
                    key={l.name}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium leading-tight text-foreground-muted"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `#${l.color}` }} />
                    {l.name}
                  </span>
                ))}
              </div>
            )}

            {/* Assignees + owner */}
            {(info.assignees.length > 0 || info.owner) && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-foreground-subtle">
                <div className="flex -space-x-1.5">
                  {info.assignees.slice(0, 5).map((a) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={a.login}
                      src={a.avatarUrl}
                      alt={a.login}
                      title={a.login}
                      className="h-4 w-4 rounded-full border border-surface"
                    />
                  ))}
                </div>
                <span className="truncate">
                  {info.owner ? `dono: @${info.owner}` : info.assignees.map((a) => `@${a.login}`).join(", ")}
                </span>
              </div>
            )}

            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2 text-[11px] text-accent">
              <ExternalLink className="h-3 w-3" /> Abrir no GitHub
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
