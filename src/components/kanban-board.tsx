"use client";

import { useEffect, useState } from "react";
import { CircleDot, GitPullRequest, SquareDashed, ExternalLink, Loader2 } from "lucide-react";
import type { KanbanResult, KanbanColumn, KanbanItem } from "@/lib/github-project";

// ---------------------------------------------------------------------------
// Luminance helper — determines whether black or white text is more readable
// on a given hex background color.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6 && clean.length !== 3) return null;
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function labelTextColor(hexColor: string): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return "#000000";
  const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
  // WCAG contrast — use black on light, white on dark
  return lum > 0.179 ? "#000000" : "#ffffff";
}

// ---------------------------------------------------------------------------
// State badge
// ---------------------------------------------------------------------------

function StateBadge({ item }: { item: KanbanItem }) {
  if (item.type === "pr") {
    if (item.merged) {
      return (
        <span className="rounded-full border border-accent-border bg-accent-bg px-2 py-0.5 text-[10px] font-medium text-accent">
          merged
        </span>
      );
    }
    if (item.state === "closed") {
      return (
        <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
          closed
        </span>
      );
    }
    return (
      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
        open
      </span>
    );
  }

  if (item.type === "issue") {
    if (item.state === "closed") {
      return (
        <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
          closed
        </span>
      );
    }
    return (
      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
        open
      </span>
    );
  }

  // draft
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
      draft
    </span>
  );
}

// ---------------------------------------------------------------------------
// Type icon
// ---------------------------------------------------------------------------

function TypeIcon({ type }: { type: KanbanItem["type"] }) {
  if (type === "issue") {
    return <CircleDot className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Issue" />;
  }
  if (type === "pr") {
    return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Pull request" />;
  }
  return <SquareDashed className="h-3.5 w-3.5 shrink-0 text-foreground-faint" aria-label="Draft issue" />;
}

// ---------------------------------------------------------------------------
// Kanban card
// ---------------------------------------------------------------------------

function KanbanCard({ item }: { item: KanbanItem }) {
  const MAX_AVATARS = 3;
  const extraAssignees =
    item.assignees.length > MAX_AVATARS ? item.assignees.length - MAX_AVATARS : 0;
  const visibleAssignees = item.assignees.slice(0, MAX_AVATARS);

  const cardInner = (
    <div className="space-y-2.5">
      {/* Title row */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          <TypeIcon type={item.type} />
        </div>
        <p className="flex-1 text-sm font-medium leading-snug text-foreground">
          {item.title}
        </p>
      </div>

      {/* Number + state badge */}
      {(item.number != null || item.type !== "draft") && (
        <div className="flex items-center gap-2">
          {item.number != null && (
            <span className="font-mono tabular-nums text-xs text-foreground-subtle">
              #{item.number}
            </span>
          )}
          <StateBadge item={item} />
        </div>
      )}

      {/* Labels */}
      {item.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.labels.map((label) => (
            <span
              key={label.name}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight"
              style={{
                backgroundColor: `#${label.color}`,
                color: labelTextColor(label.color),
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {/* Assignee avatars */}
      {item.assignees.length > 0 && (
        <div className="flex items-center gap-1">
          {visibleAssignees.map((a) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={a.login}
              src={a.avatarUrl}
              alt={a.login}
              title={a.login}
              width={20}
              height={20}
              className="h-5 w-5 rounded-full border border-border object-cover"
            />
          ))}
          {extraAssignees > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-elevated text-[9px] font-semibold tabular-nums text-foreground-subtle">
              +{extraAssignees}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (item.url) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${item.title} — open in GitHub`}
        className="block rounded-lg border border-border bg-surface p-3.5 transition-colors hover:border-border-strong hover:bg-surface-elevated"
      >
        {cardInner}
      </a>
    );
  }

  return (
    <div
      aria-label={item.title}
      className="rounded-lg border border-border bg-surface p-3.5"
    >
      {cardInner}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function KanbanColumnView({ column }: { column: KanbanColumn }) {
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-3"
      aria-label={`${column.name} column`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{column.name}</h2>
        <span className="font-mono tabular-nums text-xs text-foreground-subtle">
          {column.items.length}
        </span>
      </div>
      {/* Cards */}
      <div className="space-y-2">
        {column.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-faint">
            No items
          </p>
        ) : (
          column.items.map((item) => <KanbanCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main board component
// ---------------------------------------------------------------------------

export function KanbanBoard() {
  const [result, setResult] = useState<KanbanResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/kanban")
      .then((r) => r.json())
      .then((data: KanbanResult) => {
        if (!cancelled) {
          setResult(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setResult({ ok: false, error: message });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Loading state
  if (loading) {
    return (
      <div
        className="flex items-center gap-3 py-12 text-foreground-muted"
        aria-label="Loading Kanban board"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">Loading board…</span>
      </div>
    );
  }

  // Error state
  if (!result || !result.ok) {
    const message = result ? result.error : "Failed to load";
    return (
      <div
        className="rounded-lg border border-danger/30 bg-danger/5 p-6"
        role="alert"
        aria-label="Kanban board error"
      >
        <p className="text-sm font-medium text-danger">Failed to load Kanban board</p>
        <p className="mt-1 text-xs text-foreground-muted">{message}</p>
        {message.toLowerCase().includes("scope") ||
        message.toLowerCase().includes("permission") ||
        message.toLowerCase().includes("token") ? (
          <p className="mt-3 text-xs text-foreground-subtle">
            Make sure <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">GITHUB_TOKEN</code> is set and has{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">project</code>,{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">read:org</code>, and{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">repo</code> scopes.
          </p>
        ) : null}
      </div>
    );
  }

  const { title, url, columns, truncated } = result;

  // Empty state
  const totalItems = columns.reduce((sum, col) => sum + col.items.length, 0);
  if (totalItems === 0 && columns.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-border py-12 text-center"
        aria-label="Kanban board empty"
      >
        <p className="text-sm text-foreground-muted">No items found on this board.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Board meta bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-subtle">
          {title}
          {truncated && (
            <span className="ml-2 text-xs text-warning">
              (showing first 100 items)
            </span>
          )}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open project in GitHub"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          Open in GitHub
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      {/* Horizontal scroll board */}
      <div
        className="overflow-x-auto pb-4"
        aria-label="Kanban board"
      >
        <div className="flex gap-4" style={{ minWidth: "max-content" }}>
          {columns.map((col) => (
            <KanbanColumnView key={col.name} column={col} />
          ))}
        </div>
      </div>
    </div>
  );
}
