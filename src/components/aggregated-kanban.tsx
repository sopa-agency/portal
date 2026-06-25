"use client";

import { useEffect, useRef, useState } from "react";
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
import { GripVertical, Archive, Trash2, Plus, X, Loader2 } from "lucide-react";
import type { AggregatedColumn, AggregatedItem, KanbanItem } from "@/lib/github-project";
import type { BountyDTO } from "@/app/actions/bounty";
import { getProjectAssignees, type Assignee } from "@/app/actions/kanban";
import { BountyBadge, taskKeyOf } from "@/components/bounty-panel";
import { CardDetailDialog, FirePriority, DeadlineChip, CardFx, cardFxState } from "@/components/kanban-board";
import { useConfirm } from "@/components/confirm-dialog";

const COL_PREFIX = "aggcol:";

type ProjMeta = { slug: string; name: string; projectId: string; statusFieldId: string | null; statusOptions: { name: string; optionId: string }[] };

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

  // Deep-link: /kanban?open=<itemId> opens that card once the board has loaded.
  // We keep the param (don't strip) so the open card stays shareable.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current) return;
    openedFromUrl.current = true;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    const item = columns.flatMap((c) => c.items).find((it) => it.id === id);
    if (item) setActive(item);
  }, [columns]);

  // Keep ?open=<id> in sync with the open card so any open card has a copyable,
  // shareable URL (and closing clears it). Guarded until the deep-link above ran
  // so the initial ?open isn't stripped before columns arrive.
  useEffect(() => {
    if (!openedFromUrl.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (active) params.set("open", active.id);
    else params.delete("open");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [active]);
  const [team, setTeam] = useState<Assignee[] | null>(null);
  const [dragging, setDragging] = useState<AggregatedItem | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string[]>([]); // assignee logins (lowercase)
  const [showDone, setShowDone] = useState(false);
  const [toast, setToast] = useState<{ msg: string; level: "error" | "success" | "info" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const { confirm, confirmUI } = useConfirm();

  // Load the open card's project assignable list (for the shared dialog's assign picker).
  useEffect(() => {
    if (!active) { setTeam(null); return; }
    let live = true;
    setTeam(null);
    getProjectAssignees(active.projectSlug).then((r) => { if (live) setTeam(r.ok ? r.assignees : []); });
    return () => { live = false; };
  }, [active]);

  // Patch a card in the local board state (after dialog edits — title/body/labels).
  function patchCard(itemId: string, patch: Partial<KanbanItem>) {
    setCols((prev) => prev.map((c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) })));
    setActive((prev) => (prev && prev.id === itemId ? { ...prev, ...patch } : prev));
  }

  // All mutations target the card's OWN project board (cross-project token + session).
  async function post(targetProjectSlug: string, projectId: string, payload: Record<string, unknown>) {
    const res = await fetch("/api/kanban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, projectId, targetProjectSlug }),
    });
    return res.json();
  }
  function mutateFor(item: AggregatedItem) {
    return (payload: Record<string, unknown>) => post(item.projectSlug, item.projectId, payload);
  }

  async function setAssigneesFor(item: KanbanItem, logins: string[]) {
    const it = item as AggregatedItem;
    const optimistic = logins.map(
      (l) => it.assignees.find((a) => a.login.toLowerCase() === l.toLowerCase()) ?? { login: l, avatarUrl: `https://github.com/${l}.png?size=48` },
    );
    const prev = it.assignees;
    patchCard(it.id, { assignees: optimistic });
    const r = await post(it.projectSlug, it.projectId, { action: "setAssignees", contentId: it.contentId, itemType: it.type, logins, currentLogins: prev.map((a) => a.login) });
    if (!r.ok) { patchCard(it.id, { assignees: prev }); flash(r.error || "Falha ao atribuir."); }
  }

  async function removeCard(item: AggregatedItem, action: "archive" | "delete") {
    if (action === "delete" && !(await confirm({
      title: "Deletar card?",
      message: `Isto remove "${item.title}" permanentemente do board "${item.board}". Esta ação não pode ser desfeita.`,
      confirmLabel: "Deletar",
    }))) return;
    const snap = cols;
    setCols((prev) => prev.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== item.id) })));
    const r = await post(item.projectSlug, item.projectId, { action, itemId: item.id });
    if (!r.ok) { setCols(snap); flash(r.error || (action === "archive" ? "Falha ao arquivar." : "Falha ao deletar.")); }
    else flash(action === "archive" ? "Card arquivado." : "Card deletado.", "success");
  }

  // Create a draft on a chosen project's board, in this column's status.
  async function createCard(proj: ProjMeta, optionId: string | undefined, title: string) {
    const draft = await post(proj.slug, proj.projectId, { action: "addDraft", title });
    if (!draft.ok || !draft.itemId) { flash(draft.error || "Falha ao criar card."); return; }
    if (proj.statusFieldId && optionId) {
      await post(proj.slug, proj.projectId, { action: "setStatus", itemId: draft.itemId, fieldId: proj.statusFieldId, optionId });
    }
    router.refresh();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const byKey = new Map(bounties.map((b) => [b.taskKey, b]));
  const total = cols.reduce((n, c) => n + c.items.length, 0);
  const isDone = (name: string) => /done|conclu|complete|finaliz/i.test(name);
  const doneCount = cols.filter((c) => isDone(c.name)).reduce((n, c) => n + c.items.length, 0);
  const boards = [...new Set(cols.flatMap((c) => c.items.map((i) => i.board)))].sort();

  // People to filter by (assignees across all cards).
  const people = (() => {
    const m = new Map<string, { login: string; avatarUrl: string }>();
    for (const c of cols) for (const it of c.items) for (const a of it.assignees) {
      if (!m.has(a.login.toLowerCase())) m.set(a.login.toLowerCase(), { login: a.login, avatarUrl: a.avatarUrl });
    }
    return [...m.values()].sort((a, b) => a.login.localeCompare(b.login));
  })();
  const togglePerson = (login: string) => {
    const k = login.toLowerCase();
    setPersonFilter((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  };

  // Per-project context (for creating cards in a column on a specific project board).
  const projectsMeta = (() => {
    const m = new Map<string, ProjMeta>();
    for (const c of cols) for (const it of c.items) {
      if (!m.has(it.projectSlug)) m.set(it.projectSlug, { slug: it.projectSlug, name: it.board, projectId: it.projectId, statusFieldId: it.statusFieldId, statusOptions: it.statusOptions });
    }
    return m;
  })();
  // Projects that have a given status column (can create a card there).
  const createCandidates = (colName: string) =>
    [...projectsMeta.values()]
      .map((p) => ({ proj: p, optionId: p.statusOptions.find((o) => o.name.toLowerCase() === colName.toLowerCase())?.optionId }))
      .filter((x) => x.proj.statusFieldId && x.optionId);

  const match = (it: AggregatedItem) =>
    (!board || it.board === board) &&
    (personFilter.length === 0 || it.assignees.some((a) => personFilter.includes(a.login.toLowerCase())));
  const visible = cols
    .filter((c) => showDone || !isDone(c.name))
    .map((c) => ({ ...c, items: c.items.filter(match) }));

  function flash(m: string, level: "error" | "success" | "info" = "error") {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ msg: m, level });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
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
      flash(`"${item.board}" não tem a coluna "${targetCol}".`, "info");
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
      } else {
        flash(`Movido para "${targetCol}".`, "success");
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

      {/* Person filter */}
      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Pessoa:</span>
          <button type="button" onClick={() => setPersonFilter([])} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${personFilter.length === 0 ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>Todas</button>
          {people.map((p) => {
            const on = personFilter.includes(p.login.toLowerCase());
            return (
              <button key={p.login} type="button" onClick={() => togglePerson(p.login)} title={`@${p.login}`} aria-pressed={on} className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] ${on ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                {p.login}
              </button>
            );
          })}
        </div>
      )}

      {toast && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            toast.level === "success"
              ? "border-success/30 bg-success/10 text-success"
              : toast.level === "info"
                ? "border-border bg-surface text-foreground-muted"
                : "border-danger/30 bg-danger/10 text-danger"
          }`}
          role={toast.level === "error" ? "alert" : "status"}
        >
          {toast.msg}
        </div>
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
            <DroppableColumn
              key={col.name}
              name={col.name}
              count={col.items.length}
              candidates={canManage ? createCandidates(col.name) : []}
              onAdd={createCard}
            >
              {col.items.map((it) => (
                <DraggableCard
                  key={it.id}
                  item={it}
                  bounty={byKey.get(taskKeyOf(it))}
                  canManage={canManage}
                  onOpen={() => setActive(it)}
                  onArchive={() => removeCard(it, "archive")}
                  onDelete={() => removeCard(it, "delete")}
                />
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
        <CardDetailDialog
          item={active}
          team={team ?? []}
          memberForLogin={() => null}
          projectSlug={active.projectSlug}
          canManage={canManage}
          bounty={byKey.get(taskKeyOf(active))}
          onBountyChanged={() => router.refresh()}
          onSetAssignees={setAssigneesFor}
          onMutate={mutateFor(active)}
          onPatchItem={patchCard}
          onClose={() => setActive(null)}
        />
      )}
      {confirmUI}
    </div>
  );
}

function DroppableColumn({
  name,
  count,
  candidates,
  onAdd,
  children,
}: {
  name: string;
  count: number;
  candidates: { proj: ProjMeta; optionId: string | undefined }[];
  onAdd: (proj: ProjMeta, optionId: string | undefined, title: string) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COL_PREFIX}${name}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [projSlug, setProjSlug] = useState(candidates[0]?.proj.slug ?? "");
  const [busy, setBusy] = useState(false);
  const chosen = candidates.find((c) => c.proj.slug === projSlug) ?? candidates[0];

  async function submit() {
    if (!title.trim() || !chosen) return;
    setBusy(true);
    await onAdd(chosen.proj, chosen.optionId, title.trim());
    setBusy(false);
    setTitle("");
    setAdding(false);
  }

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface">
      <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="flex items-center gap-1">
          <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 text-[10px] text-foreground-muted">{count}</span>
          {candidates.length > 0 && (
            <button type="button" aria-label={`Novo card em ${name}`} onClick={() => setAdding((a) => !a)} className="rounded p-0.5 text-foreground-faint hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </header>
      <div ref={setNodeRef} className={`min-h-0 flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${isOver ? "bg-accent-bg/40" : ""}`}>
        {adding && candidates.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-border bg-surface-elevated p-2">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } else if (e.key === "Escape") { setTitle(""); setAdding(false); } }}
              rows={2}
              autoFocus
              placeholder="Título do card… (Enter cria, Esc cancela)"
              className="w-full resize-none rounded-md bg-surface px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-faint focus:ring-1 focus:ring-accent-border"
            />
            <div className="flex items-center gap-1.5">
              <select value={projSlug} onChange={(e) => setProjSlug(e.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] text-foreground">
                {candidates.map((c) => <option key={c.proj.slug} value={c.proj.slug}>{c.proj.name}</option>)}
              </select>
              <button type="button" onClick={() => { setTitle(""); setAdding(false); }} className="rounded-md p-1 text-foreground-faint hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={submit} disabled={busy || !title.trim()} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </button>
            </div>
          </div>
        )}
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
        <FirePriority value={item.firePriority} />
        <DeadlineChip value={item.deadline} className="ml-auto" />
      </div>
      <p className="line-clamp-3 text-sm text-foreground">{item.title}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {item.labels.slice(0, 3).map((l) => (
          <span
            key={l.name}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[9px] font-medium leading-tight text-foreground-muted"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `#${l.color}` }} aria-hidden="true" />
            {l.name}
          </span>
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

function DraggableCard({ item, bounty, canManage, onOpen, onArchive, onDelete }: { item: AggregatedItem; bounty?: BountyDTO; canManage: boolean; onOpen: () => void; onArchive: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  const { onFire, frozen } = cardFxState(item);
  const fxClass = onFire ? "kb-on-fire border-orange-500/70" : frozen ? "border-cyan-300/70" : "border-border hover:border-border-strong";
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative overflow-hidden rounded-lg border bg-surface-elevated p-2.5 transition-colors ${fxClass}`}
    >
      <CardFx onFire={onFire} frozen={frozen} />
      {/* Hover actions: drag · archive · delete */}
      <div className="absolute right-1 top-1 z-30 flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/95 p-0.5 opacity-100 shadow-sm backdrop-blur transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        {canManage && (
          <>
            <button type="button" aria-label="Arquivar" onPointerDown={(e) => e.stopPropagation()} onClick={onArchive} className="rounded p-0.5 text-foreground-faint hover:text-foreground"><Archive className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Deletar" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete} className="rounded p-0.5 text-foreground-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
        <button
          type="button"
          aria-label="Mover card"
          className="cursor-grab touch-none rounded p-0.5 text-foreground-faint hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <button type="button" onClick={onOpen} className="relative z-10 block w-full text-left">
        <CardInner item={item} bounty={bounty} />
      </button>
    </div>
  );
}
