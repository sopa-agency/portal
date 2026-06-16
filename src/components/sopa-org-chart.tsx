"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, X, Trash2, Check, Loader2 } from "lucide-react";
import {
  type BoardCard,
  createCard,
  updateCard,
  deleteCard,
} from "@/app/actions/sopa-boards";

type Node = BoardCard & { children: Node[] };

function buildTree(cards: BoardCard[]): Node[] {
  const byId = new Map<string, Node>();
  cards.forEach((c) => byId.set(c.id, { ...c, children: [] }));
  const roots: Node[] = [];
  byId.forEach((n) => {
    if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId)!.children.push(n);
    else roots.push(n);
  });
  return roots;
}

export function SopaOrgChart({ initial }: { initial: BoardCard[] }) {
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tree = useMemo(() => buildTree(cards), [cards]);
  const openCard = cards.find((c) => c.id === openId) ?? null;

  function addChild(parentId: string, title: string) {
    startTransition(async () => {
      const created = await createCard({ board: "orgchart", parentId, title });
      setCards((prev) => [...prev, created]);
    });
  }

  function saveCard(id: string, patch: { title?: string; body?: string }) {
    startTransition(async () => {
      const updated = await updateCard(id, patch);
      setCards((prev) => prev.map((c) => (c.id === id ? updated : c)));
    });
  }

  function removeCard(id: string) {
    startTransition(async () => {
      const { deleted } = await deleteCard(id);
      const gone = new Set(deleted);
      setCards((prev) => prev.filter((c) => !gone.has(c.id)));
      setOpenId(null);
    });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            SOPA
          </p>
          <h1 className="text-2xl font-bold text-foreground">Org Chart</h1>
        </div>
        {pending && (
          <span className="flex items-center gap-1.5 text-xs text-foreground-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> salvando…
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-surface p-8">
        <div className="sopa-org flex min-w-max justify-center">
          <ul>
            {tree.map((n) => (
              <TreeNode
                key={n.id}
                node={n}
                onOpen={setOpenId}
                onAddChild={addChild}
                disabled={pending}
              />
            ))}
          </ul>
        </div>
      </div>

      {openCard && (
        <CardDialog
          card={openCard}
          isRoot={openCard.parentId === null}
          onClose={() => setOpenId(null)}
          onSave={saveCard}
          onDelete={removeCard}
          busy={pending}
        />
      )}

      {/* Classic CSS org-tree connectors — colored with the theme border token so
          they read in light + dark. Scoped under .sopa-org. */}
      <style>{`
        .sopa-org ul { display: flex; padding-top: 22px; position: relative; }
        .sopa-org li {
          list-style: none; position: relative; display: flex; flex-direction: column;
          align-items: center; padding: 22px 14px 0;
        }
        .sopa-org li::before, .sopa-org li::after {
          content: ''; position: absolute; top: 0; right: 50%;
          border-top: 1px solid var(--border); width: 50%; height: 22px;
        }
        .sopa-org li::after {
          right: auto; left: 50%; border-left: 1px solid var(--border);
        }
        .sopa-org li:only-child::before, .sopa-org li:only-child::after { display: none; }
        .sopa-org li:only-child { padding-top: 0; }
        .sopa-org li:first-child::before, .sopa-org li:last-child::after { border: 0 none; }
        .sopa-org li:last-child::before { border-right: 1px solid var(--border); }
        .sopa-org > ul { padding-top: 0; }
        .sopa-org ul ul::before {
          content: ''; position: absolute; top: 0; left: 50%;
          border-left: 1px solid var(--border); width: 0; height: 22px;
        }
      `}</style>
    </div>
  );
}

function TreeNode({
  node,
  onOpen,
  onAddChild,
  disabled,
}: {
  node: Node;
  onOpen: (id: string) => void;
  onAddChild: (parentId: string, title: string) => void;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const isRoot = node.parentId === null;

  function confirmAdd() {
    const t = draft.trim();
    if (t) onAddChild(node.id, t);
    setDraft("");
    setAdding(false);
  }

  return (
    <li>
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          className={`group min-w-[140px] max-w-[200px] rounded-xl border px-4 py-2.5 text-center shadow-sm transition hover:border-border-strong ${
            isRoot
              ? "border-accent-border bg-accent-bg"
              : "border-border bg-surface-elevated"
          }`}
        >
          <span
            className={`block truncate text-sm font-semibold ${
              isRoot ? "text-accent" : "text-foreground"
            }`}
          >
            {node.title}
          </span>
          {node.body && (
            <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">
              {node.body}
            </span>
          )}
        </button>

        {adding ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmAdd();
                if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder="Nome…"
              className="w-28 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={confirmAdd}
              aria-label="Adicionar"
              className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              aria-label="Cancelar"
              className="rounded-md border border-border p-1 text-foreground-muted hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAdding(true)}
            aria-label="Adicionar item"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-foreground-faint transition hover:border-accent-border hover:text-accent disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              onOpen={onOpen}
              onAddChild={onAddChild}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CardDialog({
  card,
  isRoot,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  card: BoardCard;
  isRoot: boolean;
  onClose: () => void;
  onSave: (id: string, patch: { title?: string; body?: string }) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body ?? "");
  const [confirmDel, setConfirmDel] = useState(false);
  const dirty = title !== card.title || body !== (card.body ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Detalhes do card</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-foreground-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Nome</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Detalhes</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Notas, papel, links…"
          className="mb-4 w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        <div className="flex items-center justify-between">
          {!isRoot ? (
            confirmDel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(card.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Confirmar exclusão
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground-muted hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            )
          ) : (
            <span className="text-[11px] text-foreground-faint">A raiz não pode ser excluída</span>
          )}

          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => onSave(card.id, { title, body })}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
