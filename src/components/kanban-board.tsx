"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CircleDot,
  GitPullRequest,
  SquareDashed,
  ExternalLink,
  Loader2,
  Plus,
  Archive,
  Trash2,
  X,
  GripVertical,
} from "lucide-react";
import type { KanbanResult, KanbanColumn, KanbanItem } from "@/lib/github-project";
import { MarkdownContent } from "@/components/markdown-content";

// ---------------------------------------------------------------------------
// Column status color (mid-tone hues that read on both light & dark surfaces)
// ---------------------------------------------------------------------------

function statusColor(name: string): string {
  const n = name.toLowerCase();
  if (/backlog|icebox|later/.test(n)) return "#8b949e"; // gray
  if (/ready|todo|to do|next/.test(n)) return "#3b82f6"; // blue
  if (/progress|doing|wip|active/.test(n)) return "#f59e0b"; // amber
  if (/review|qa|test/.test(n)) return "#a371f7"; // purple
  if (/done|complete|shipped|closed/.test(n)) return "#22c55e"; // green
  return "#8b949e";
}

// ---------------------------------------------------------------------------
// Badges / icons
// ---------------------------------------------------------------------------

function StateBadge({ item }: { item: KanbanItem }) {
  if (item.type === "pr") {
    if (item.merged)
      return <span className="rounded-full border border-[#a371f7]/30 bg-[#a371f7]/10 px-2 py-0.5 text-[10px] font-medium text-[#a371f7]">merged</span>;
    if (item.state === "closed")
      return <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">closed</span>;
    return <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">open</span>;
  }
  if (item.type === "issue") {
    if (item.state === "closed")
      return <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">closed</span>;
    return <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">open</span>;
  }
  return <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground-muted">draft</span>;
}

function TypeIcon({ type }: { type: KanbanItem["type"] }) {
  if (type === "issue") return <CircleDot className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Issue" />;
  if (type === "pr") return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-[#a371f7]" aria-label="Pull request" />;
  return <SquareDashed className="h-3.5 w-3.5 shrink-0 text-foreground-faint" aria-label="Draft issue" />;
}

// ---------------------------------------------------------------------------
// Card body (shared by sortable card + drag overlay)
// ---------------------------------------------------------------------------

function CardBody({ item }: { item: KanbanItem }) {
  const MAX_AVATARS = 3;
  const extra = item.assignees.length > MAX_AVATARS ? item.assignees.length - MAX_AVATARS : 0;
  const visible = item.assignees.slice(0, MAX_AVATARS);
  return (
    <div className="space-y-2.5">
      <p className="pr-5 text-[13px] font-medium leading-snug text-foreground">{item.title}</p>

      {item.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.labels.map((label) => (
            <span
              key={label.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium leading-tight text-foreground-muted"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: `#${label.color}` }}
                aria-hidden="true"
              />
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <TypeIcon type={item.type} />
        {item.number != null && (
          <span className="font-mono tabular-nums text-[11px] text-foreground-subtle">#{item.number}</span>
        )}
        <StateBadge item={item} />
        {item.assignees.length > 0 && (
          <div className="ml-auto flex items-center -space-x-1.5">
            {visible.map((a) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} width={22} height={22}
                className="h-[22px] w-[22px] rounded-full object-cover ring-2 ring-surface-elevated" />
            ))}
            {extra > 0 && (
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface text-[9px] font-semibold tabular-nums text-foreground-subtle ring-2 ring-surface-elevated">
                +{extra}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable card
// ---------------------------------------------------------------------------

function SortableCard({
  item,
  onArchive,
  onDelete,
  onOpen,
  busy,
}: {
  item: KanbanItem;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (item: KanbanItem) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-xl border border-border bg-surface-elevated p-3 shadow-sm transition-all hover:border-border-strong hover:shadow-md"
    >
      {/* Drag handle + body */}
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          aria-label="Drag card"
          className="-ml-1 mt-0.5 cursor-grab touch-none rounded p-0.5 text-foreground-faint opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-label={`Open ${item.title}`}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <CardBody item={item} />
        </button>
      </div>

      {/* Action buttons — appear on hover */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in GitHub"
            className="rounded p-1 text-foreground-faint hover:bg-foreground/5 hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          aria-label="Archive card"
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onArchive(item.id)}
          className="rounded p-1 text-foreground-faint hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Delete card"
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(item.id)}
          className="rounded p-1 text-foreground-faint hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column (droppable)
// ---------------------------------------------------------------------------

function ColumnView({
  column,
  onArchive,
  onDelete,
  onAddDraft,
  onOpen,
  busy,
}: {
  column: KanbanColumn;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onAddDraft: (columnName: string, title: string) => void;
  onOpen: (item: KanbanItem) => void;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `container:${column.name}` });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function submit() {
    const t = draft.trim();
    if (t) onAddDraft(column.name, t);
    setDraft("");
    setAdding(false);
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-64 flex-1 basis-80 flex-col rounded-xl border border-border bg-surface/60"
      aria-label={`${column.name} column`}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor(column.optionId ? column.name : "") }}
            aria-hidden="true"
          />
          <h2 className="truncate text-sm font-semibold text-foreground">{column.name}</h2>
          <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground-subtle">
            {column.items.length}
          </span>
        </div>
        <button
          type="button"
          aria-label={`Add card to ${column.name}`}
          onClick={() => setAdding((a) => !a)}
          className="rounded-md p-1 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl p-2 pt-0.5 transition-colors ${
          isOver ? "bg-accent-bg/40" : ""
        }`}
      >
        {adding && (
          <div className="rounded-xl border border-border bg-surface-elevated p-2 shadow-sm">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
              placeholder="Draft title… (Enter to add, Esc to cancel)"
              rows={2}
              className="w-full resize-none rounded-md bg-surface px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-faint focus:ring-1 focus:ring-accent-border"
            />
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => { setDraft(""); setAdding(false); }}
                className="rounded-md p-1 text-foreground-faint hover:bg-foreground/5 hover:text-foreground"
                aria-label="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim()}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}

        <SortableContext items={column.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {column.items.length === 0 && !adding ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 py-8">
              <p className="text-xs text-foreground-faint">Drop cards here</p>
            </div>
          ) : (
            column.items.map((item) => (
              <SortableCard key={item.id} item={item} onArchive={onArchive} onDelete={onDelete} onOpen={onOpen} busy={busy} />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card detail dialog — full issue/PR/draft content
// ---------------------------------------------------------------------------

/** Derive "owner/repo" from a GitHub issue/PR URL for #N autolinking. */
function repoOf(url?: string): string | undefined {
  const m = url?.match(/github\.com\/([^/]+\/[^/]+)\//);
  return m?.[1];
}

function CardDetailDialog({
  item,
  team,
  onSetAssignees,
  onClose,
}: {
  item: KanbanItem;
  /** Teammates with a GitHub contact on their team card — the assign options. */
  team: { username: string; login: string }[];
  onSetAssignees: (item: KanbanItem, logins: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const canAssign = item.contentId != null && team.length > 0;

  async function toggleAssignee(login: string) {
    const has = item.assignees.some((a) => a.login.toLowerCase() === login.toLowerCase());
    const desired = has
      ? item.assignees.filter((a) => a.login.toLowerCase() !== login.toLowerCase()).map((a) => a.login)
      : [...item.assignees.map((a) => a.login), login];
    setAssignBusy(true);
    try {
      await onSetAssignees(item, desired);
    } finally {
      setAssignBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <TypeIcon type={item.type} />
              {item.number != null && (
                <span className="font-mono tabular-nums text-xs text-foreground-subtle">#{item.number}</span>
              )}
              <StateBadge item={item} />
            </div>
            <h3 className="text-lg font-semibold leading-snug text-foreground">{item.title}</h3>
            {item.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.labels.map((label) => (
                  <span
                    key={label.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium leading-tight text-foreground-muted"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `#${label.color}` }}
                      aria-hidden="true"
                    />
                    {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close card"
            className="shrink-0 rounded-lg border border-border p-2 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {item.body?.trim() ? (
            <MarkdownContent markdown={item.body} githubRepo={repoOf(item.url)} />
          ) : (
            <p className="text-sm italic text-foreground-faint">No description.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <div className="relative flex min-w-0 items-center gap-2">
            {item.assignees.length > 0 ? (
              <>
                <div className="flex -space-x-1.5">
                  {item.assignees.map((a) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} width={24} height={24}
                      className="h-6 w-6 rounded-full object-cover ring-2 ring-surface-elevated" />
                  ))}
                </div>
                <span className="truncate text-xs text-foreground-subtle">
                  {item.assignees.map((a) => `@${a.login}`).join(", ")}
                </span>
              </>
            ) : (
              <span className="text-xs text-foreground-faint">Unassigned</span>
            )}
            {canAssign && (
              <button
                type="button"
                onClick={() => setAssignOpen((v) => !v)}
                aria-expanded={assignOpen}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                Assign
              </button>
            )}
            {assignOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAssignOpen(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-xl border border-border bg-surface-elevated py-1 shadow-xl">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-foreground-faint">
                    Team (GitHub from team cards)
                  </p>
                  {team.map((m) => {
                    const checked = item.assignees.some(
                      (a) => a.login.toLowerCase() === m.login.toLowerCase(),
                    );
                    return (
                      <button
                        key={m.login}
                        type="button"
                        disabled={assignBusy}
                        onClick={() => toggleAssignee(m.login)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://github.com/${m.login}.png?size=48`}
                          alt={m.login}
                          width={22}
                          height={22}
                          className="h-[22px] w-[22px] rounded-full object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-foreground">@{m.login}</span>
                          <span className="block truncate text-[11px] text-foreground-subtle">{m.username}</span>
                        </span>
                        {checked && <span className="text-accent">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              Open in GitHub
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

type Board = Extract<KanbanResult, { ok: true }> & {
  /** Portal-username → GitHub-login mapping sourced from the team cards. */
  teamGithub?: { username: string; login: string }[];
};

export function KanbanBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<KanbanItem | null>(null);
  const [detailItem, setDetailItem] = useState<KanbanItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/kanban");
      const data = (await r.json()) as KanbanResult;
      if (data.ok) {
        setBoard(data);
        setError(null);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  // --- mutation helper ---
  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; itemId?: string };
      return data;
    },
    [],
  );

  // --- DnD: locate the column a card / container id belongs to ---
  function columnNameOf(id: string): string | undefined {
    if (id.startsWith("container:")) return id.slice("container:".length);
    return board?.columns.find((c) => c.items.some((it) => it.id === id))?.name;
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const item = board?.columns.flatMap((c) => c.items).find((it) => it.id === id) ?? null;
    setActiveItem(item);
  }

  // Move card between containers during drag for live preview.
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || !board) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const fromCol = columnNameOf(activeId);
    const toCol = columnNameOf(overId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    setBoard((prev) => {
      if (!prev) return prev;
      const cols = prev.columns.map((c) => ({ ...c, items: [...c.items] }));
      const from = cols.find((c) => c.name === fromCol)!;
      const to = cols.find((c) => c.name === toCol)!;
      const idx = from.items.findIndex((it) => it.id === activeId);
      if (idx === -1) return prev;
      const [moved] = from.items.splice(idx, 1);
      // Insert at the over-card's position, or append if dropping on the container.
      const overIdx = to.items.findIndex((it) => it.id === overId);
      if (overIdx === -1) to.items.push(moved);
      else to.items.splice(overIdx, 0, moved);
      return { ...prev, columns: cols };
    });
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveItem(null);
    if (!over || !board) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const toCol = columnNameOf(overId);
    if (!toCol) return;
    const targetCol = board.columns.find((c) => c.name === toCol)!;

    // Reorder within the target column (state already reflects cross-column move
    // from handleDragOver; here we settle same-column ordering).
    let nextBoard = board;
    const sameColOverItem = targetCol.items.findIndex((it) => it.id === overId);
    const activeIdx = targetCol.items.findIndex((it) => it.id === activeId);
    if (activeIdx !== -1 && sameColOverItem !== -1 && activeIdx !== sameColOverItem) {
      const cols = board.columns.map((c) =>
        c.name === toCol ? { ...c, items: arrayMove(c.items, activeIdx, sameColOverItem) } : c,
      );
      nextBoard = { ...board, columns: cols };
      setBoard(nextBoard);
    }

    // Persist: set/clear status for the target column, then fix position.
    const col = nextBoard.columns.find((c) => c.name === toCol)!;
    const newIdx = col.items.findIndex((it) => it.id === activeId);
    const afterId = newIdx > 0 ? col.items[newIdx - 1].id : null;

    setBusy(true);
    try {
      if (nextBoard.statusFieldId) {
        if (col.optionId) {
          const r = await mutate({
            action: "setStatus",
            projectId: nextBoard.projectId,
            fieldId: nextBoard.statusFieldId,
            itemId: activeId,
            optionId: col.optionId,
          });
          if (!r.ok) throw new Error(r.error || "Failed to set status");
        } else {
          // "No Status" column — clear the field.
          const r = await mutate({
            action: "clearStatus",
            projectId: nextBoard.projectId,
            fieldId: nextBoard.statusFieldId,
            itemId: activeId,
          });
          if (!r.ok) throw new Error(r.error || "Failed to clear status");
        }
      }
      const rp = await mutate({
        action: "move",
        projectId: nextBoard.projectId,
        itemId: activeId,
        afterId,
      });
      if (!rp.ok) throw new Error(rp.error || "Failed to reorder");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Update failed — reverting");
      await load();
    } finally {
      setBusy(false);
    }
  }

  // --- card actions ---
  async function onAddDraft(columnName: string, title: string) {
    if (!board) return;
    const col = board.columns.find((c) => c.name === columnName);
    setBusy(true);
    try {
      const r = await mutate({ action: "addDraft", projectId: board.projectId, title });
      if (!r.ok || !r.itemId) throw new Error(r.error || "Failed to add draft");
      if (board.statusFieldId && col?.optionId) {
        await mutate({
          action: "setStatus",
          projectId: board.projectId,
          fieldId: board.statusFieldId,
          itemId: r.itemId,
          optionId: col.optionId,
        });
      }
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to add draft");
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(itemId: string) {
    if (!board) return;
    setBusy(true);
    try {
      const r = await mutate({ action: "archive", projectId: board.projectId, itemId });
      if (!r.ok) throw new Error(r.error || "Failed to archive");
      setBoard((prev) =>
        prev ? { ...prev, columns: prev.columns.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) })) } : prev,
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to archive");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(itemId: string) {
    if (!board) return;
    if (!window.confirm("Permanently delete this card from the project? This cannot be undone.")) return;
    setBusy(true);
    try {
      const r = await mutate({ action: "delete", projectId: board.projectId, itemId });
      if (!r.ok) throw new Error(r.error || "Failed to delete");
      setBoard((prev) =>
        prev ? { ...prev, columns: prev.columns.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) })) } : prev,
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  async function onSetAssignees(item: KanbanItem, logins: string[]) {
    if (!board || !item.contentId) return;
    const currentLogins = item.assignees.map((a) => a.login);
    // Optimistic: GitHub avatars are predictable from the login.
    const optimistic = logins.map(
      (login) =>
        item.assignees.find((a) => a.login.toLowerCase() === login.toLowerCase()) ?? {
          login,
          avatarUrl: `https://github.com/${login}.png?size=48`,
        },
    );
    const patch = (i: KanbanItem) => (i.id === item.id ? { ...i, assignees: optimistic } : i);
    setBoard((prev) =>
      prev ? { ...prev, columns: prev.columns.map((c) => ({ ...c, items: c.items.map(patch) })) } : prev,
    );
    setDetailItem((prev) => (prev && prev.id === item.id ? { ...prev, assignees: optimistic } : prev));
    try {
      const r = await mutate({
        action: "setAssignees",
        projectId: board.projectId,
        contentId: item.contentId,
        itemType: item.type,
        logins,
        currentLogins,
      });
      if (!r.ok) throw new Error(r.error || "Failed to update assignees");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to update assignees");
      await load();
    }
  }

  // --- render ---
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden" aria-label="Loading Kanban board">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-full min-h-64 min-w-64 flex-1 basis-80 animate-pulse flex-col rounded-xl border border-border bg-surface/60 p-2">
            <div className="m-1 mb-3 h-4 w-24 rounded bg-foreground/[0.07]" />
            <div className="space-y-2">
              <div className="h-20 rounded-xl bg-foreground/[0.05]" />
              <div className="h-14 rounded-xl bg-foreground/[0.05]" />
              {i % 2 === 0 && <div className="h-20 rounded-xl bg-foreground/[0.05]" />}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error || !board) {
    const message = error ?? "Failed to load";
    const hint = /scope|permission|token/i.test(message);
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-6" role="alert">
        <p className="text-sm font-medium text-danger">Failed to load Kanban board</p>
        <p className="mt-1 text-xs text-foreground-muted">{message}</p>
        {hint && (
          <p className="mt-3 text-xs text-foreground-subtle">
            Make sure <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">GITHUB_TOKEN</code> has{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">project</code>,{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">read:org</code>, and{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">repo</code> scopes.
          </p>
        )}
      </div>
    );
  }

  const { title, url, columns, truncated } = board;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Meta bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-foreground-subtle">
          {title}
          {truncated && <span className="text-xs text-warning">(first 100 items)</span>}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-faint" aria-label="Saving" />}
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

      {toast && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
          {toast}
        </div>
      )}

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="min-h-0 flex-1 overflow-x-auto pb-2">
          <div className="flex h-full min-h-64 gap-4">
            {columns.map((col) => (
              <ColumnView
                key={col.name}
                column={col}
                onArchive={onArchive}
                onDelete={onDelete}
                onAddDraft={onAddDraft}
                onOpen={setDetailItem}
                busy={busy}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeItem ? (
            <div className="w-72 rotate-2 rounded-xl border border-accent-border bg-surface-elevated p-3 shadow-2xl">
              <CardBody item={activeItem} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {detailItem && (
        <CardDetailDialog
          item={detailItem}
          team={board.teamGithub ?? []}
          onSetAssignees={onSetAssignees}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
}
