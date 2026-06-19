"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ExternalLink, X, GripVertical } from "lucide-react";
import type { AggregatedColumn, AggregatedItem } from "@/lib/github-project";
import type { BountyDTO } from "@/app/actions/bounty";
import { BountyBadge, BountyPanel, ExecMeetingButton, taskKeyOf } from "@/components/bounty-panel";

const COL_PREFIX = "aggcol:";

// Aggregated board for the SOPA hub: every portal's Kanban merged by status.
// Cards are draggable — dropping into another column changes the card's status
// on ITS OWN project board (cross-project mutation). Cards also open a details
// dialog: create an EXEC meeting or (global admins) turn it into a bounty.
export function AggregatedKanban({
  columns,
  bounties,
  canManage,
}: {
  columns: AggregatedColumn[];
  bounties: BountyDTO[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [cols, setCols] = useState<AggregatedColumn[]>(columns);
  useEffect(() => setCols(columns), [columns]);
  const [active, setActive] = useState<AggregatedItem | null>(null);
  const [dragging, setDragging] = useState<AggregatedItem | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const byKey = new Map(bounties.map((b) => [b.taskKey, b]));
  const total = cols.reduce((n, c) => n + c.items.length, 0);
  const isDone = (name: string) => /done|conclu|complete|finaliz/i.test(name);
  const doneCount = cols.filter((c) => isDone(c.name)).reduce((n, c) => n + c.items.length, 0);
  const boards = [...new Set(cols.flatMap((c) => c.items.map((i) => i.board)))].sort();
  const match = (it: AggregatedItem) => !board || it.board === board;
  const visible = cols
    .filter((c) => showDone || !isDone(c.name))
    .map((c) => ({ ...c, items: c.items.filter(match) }));

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  }

  function colNameOfDrop(overId: string): string | null {
    if (overId.startsWith(COL_PREFIX)) return overId.slice(COL_PREFIX.length);
    // dropped onto a card → that card's column
    for (const c of cols) if (c.items.some((i) => i.id === overId)) return c.name;
    return null;
  }

  async function handleDragEnd(e: DragEndEvent) {
    const item = dragging;
    setDragging(null);
    if (!item || !e.over) return;
    const targetCol = colNameOfDrop(String(e.over.id));
    const sourceCol = cols.find((c) => c.items.some((i) => i.id === item.id))?.name;
    if (!targetCol || targetCol === sourceCol) return;

    const opt = item.statusOptions.find((o) => o.name.toLowerCase() === targetCol.toLowerCase());
    if (!item.statusFieldId || !opt) {
      flash(`"${item.board}" não tem a coluna "${targetCol}".`);
      return;
    }

    // Optimistic move (snapshot for revert).
    const snapshot = cols;
    setCols((prev) =>
      prev.map((c) => {
        if (c.name === sourceCol) return { ...c, items: c.items.filter((i) => i.id !== item.id) };
        if (c.name === targetCol) return { ...c, items: [item, ...c.items] };
        return c;
      }),
    );

    try {
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setStatus",
          targetProjectSlug: item.projectSlug,
          projectId: item.projectId,
          fieldId: item.statusFieldId,
          optionId: opt.optionId,
          itemId: item.id,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setCols(snapshot);
        flash(data.error || "Falha ao mover o card.");
      }
    } catch {
      setCols(snapshot);
      flash("Falha de rede ao mover o card.");
    }
  }

  if (total === 0) {
    return <p className="text-sm text-foreground-muted">Nenhuma tarefa nos boards (ou tokens do GitHub indisponíveis).</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Project filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Projeto:</span>
        <button type="button" onClick={() => setBoard(null)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${board === null ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
          Todos <span className="text-foreground-faint">({total})</span>
        </button>
        {boards.map((b) => {
          const n = cols.reduce((s, c) => s + c.items.filter((i) => i.board === b).length, 0);
          return (
            <button key={b} type="button" onClick={() => setBoard(b)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${board === b ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
              {b} <span className="text-foreground-faint">({n})</span>
            </button>
          );
        })}
        {doneCount > 0 && (
          <button type="button" onClick={() => setShowDone((v) => !v)} className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${showDone ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
            {showDone ? "Ocultar concluídas" : "Mostrar concluídas"} <span className="text-foreground-faint">({doneCount})</span>
          </button>
        )}
      </div>

      {toast && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">{toast}</div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setDragging(cols.flatMap((c) => c.items).find((i) => i.id === e.active.id) ?? null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {visible.map((col) => (
            <DroppableColumn key={col.name} name={col.name} count={col.items.length}>
              {col.items.map((it) => (
                <DraggableCard key={it.id} item={it} bounty={byKey.get(taskKeyOf(it))} onOpen={() => setActive(it)} />
              ))}
            </DroppableColumn>
          ))}
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="w-64 rotate-2 rounded-lg border border-accent-border bg-surface-elevated p-2.5 shadow-2xl">
              <CardInner item={dragging} bounty={byKey.get(taskKeyOf(dragging))} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {active && (
        <TaskDialog
          item={active}
          bounty={byKey.get(taskKeyOf(active))}
          canManage={canManage}
          onClose={() => setActive(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function DroppableColumn({ name, count, children }: { name: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COL_PREFIX}${name}` });
  return (
    <section className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface">
      <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 text-[10px] text-foreground-muted">{count}</span>
      </header>
      <div ref={setNodeRef} className={`min-h-0 flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${isOver ? "bg-accent-bg/40" : ""}`}>
        {children}
      </div>
    </section>
  );
}

function CardInner({ item, bounty }: { item: AggregatedItem; bounty?: BountyDTO }) {
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">{item.board}</span>
        {item.number ? <span className="text-[10px] text-foreground-faint">#{item.number}</span> : null}
        {bounty && <BountyBadge bounty={bounty} />}
      </div>
      <p className="line-clamp-3 text-sm text-foreground">{item.title}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {item.labels.slice(0, 3).map((l) => (
          <span key={l.name} className="rounded px-1 text-[9px]" style={{ backgroundColor: `#${l.color}22`, color: `#${l.color}` }}>{l.name}</span>
        ))}
        <span className="ml-auto flex -space-x-1.5">
          {item.assignees.slice(0, 4).map((a) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} className="h-4 w-4 rounded-full border border-surface object-cover" />
          ))}
        </span>
      </div>
    </>
  );
}

function DraggableCard({ item, bounty, onOpen }: { item: AggregatedItem; bounty?: BountyDTO; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-lg border border-border bg-surface-elevated p-2.5 transition-colors hover:border-border-strong"
    >
      <button
        type="button"
        aria-label="Mover card"
        className="absolute right-1 top-1 cursor-grab touch-none rounded p-0.5 text-foreground-faint opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <CardInner item={item} bounty={bounty} />
      </button>
    </div>
  );
}

function TaskDialog({
  item,
  bounty,
  canManage,
  onClose,
  onChanged,
}: {
  item: AggregatedItem;
  bounty: BountyDTO | undefined;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">{item.board}</span>
              {item.number ? <span className="text-xs text-foreground-faint">#{item.number}</span> : null}
              {bounty && <BountyBadge bounty={bounty} />}
            </div>
            <h3 className="text-base font-bold text-foreground">{item.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {item.assignees.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Responsáveis</span>
            <span className="flex flex-wrap items-center gap-1">
              {item.assignees.map((a) => (
                <span key={a.login} className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.avatarUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                  {a.login}
                </span>
              ))}
            </span>
          </div>
        )}

        {item.body ? (
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-elevated p-3 text-sm text-foreground-muted">{item.body}</div>
        ) : null}

        <BountyPanel
          projectSlug={item.projectSlug}
          taskKey={taskKeyOf(item)}
          title={item.title}
          bounty={bounty}
          canManage={canManage}
          onChanged={onChanged}
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ExecMeetingButton projectSlug={item.projectSlug} title={item.title} body={item.body} logins={item.assignees.map((a) => a.login)} />
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-border-strong hover:text-foreground">
              <ExternalLink className="h-4 w-4" /> Abrir no GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
