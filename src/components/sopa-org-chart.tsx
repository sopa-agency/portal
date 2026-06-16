"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, X, Trash2, Check, Loader2, ImagePlus } from "lucide-react";
import {
  type BoardCard,
  type TeamMember,
  createCard,
  updateCard,
  deleteCard,
} from "@/app/actions/sopa-boards";
import { uploadSopaLogo } from "@/lib/sopa-logo-upload";

// Engagement tiers + the roles defined for the agency. Stored on each node so a
// project rectangle shows its tier of work and who's on each role.
const TIERS = [
  { id: "pontual", label: "Pontual", pct: "20%" },
  { id: "operacao", label: "Operação", pct: "30%" },
  { id: "motor", label: "Motor", pct: "40%" },
] as const;

const ROLES = [
  "Dev lead",
  "Marketing lead",
  "Design / Criação",
  "Comunidade / Social",
  "Operações / Financeiro",
  "Business Development",
] as const;

const tierMeta = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;

// Native projects are the brand's own (one color); everything else under SOPA is
// a client (another color). Only clients carry an engagement tier.
const NATIVE_PROJECTS = new Set(["reelflip", "gnars", "skatehive", "blockwire"]);
type NodeKind = "root" | "native" | "client";
function nodeKind(node: { parentId: string | null; title: string }): NodeKind {
  if (node.parentId === null) return "root";
  return NATIVE_PROJECTS.has(node.title.trim().toLowerCase()) ? "native" : "client";
}
const KIND_STYLE: Record<NodeKind, { wrap: string; title: string; badge: string | null }> = {
  root: { wrap: "border-accent-border bg-accent-bg", title: "text-accent", badge: null },
  native: { wrap: "border-accent-border bg-surface-elevated", title: "text-accent", badge: "Nativo" },
  client: {
    wrap: "border-sky-400/40 bg-sky-400/10",
    title: "text-sky-600 dark:text-sky-300",
    badge: "Cliente",
  },
};

export type Person = { username: string; avatarUrl: string; profileUrl: string };

type CardPatch = {
  title?: string;
  body?: string;
  tier?: string | null;
  team?: TeamMember[];
  logoUrl?: string | null;
};

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

export function SopaOrgChart({
  initial,
  roster,
}: {
  initial: BoardCard[];
  roster: Person[];
}) {
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tree = useMemo(() => buildTree(cards), [cards]);
  const rosterMap = useMemo(
    () => new Map(roster.map((p) => [p.username.toLowerCase(), p])),
    [roster],
  );
  const openCard = cards.find((c) => c.id === openId) ?? null;

  function addChild(parentId: string, title: string) {
    startTransition(async () => {
      const created = await createCard({ board: "orgchart", parentId, title });
      setCards((prev) => [...prev, created]);
    });
  }

  function saveCard(id: string, patch: CardPatch) {
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
                rosterMap={rosterMap}
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
          roster={roster}
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
  rosterMap,
  onOpen,
  onAddChild,
  disabled,
}: {
  node: Node;
  rosterMap: Map<string, Person>;
  onOpen: (id: string) => void;
  onAddChild: (parentId: string, title: string) => void;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const kind = nodeKind(node);
  const style = KIND_STYLE[kind];
  const showTier = kind === "client" && tierMeta(node.tier);

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
          className={`group w-[200px] rounded-xl border px-4 py-3 text-center shadow-sm transition hover:border-border-strong ${style.wrap}`}
        >
          {style.badge && (
            <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.15em] text-foreground-faint">
              {style.badge}
            </span>
          )}
          {node.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={node.logoUrl}
              alt=""
              className="mx-auto mb-1.5 h-9 w-9 rounded-lg border border-border bg-surface object-contain p-0.5"
            />
          )}
          <div className="flex items-center justify-center gap-2">
            <span className={`truncate text-sm font-semibold ${style.title}`}>{node.title}</span>
            {showTier && (
              <span className="shrink-0 rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-300">
                {tierMeta(node.tier)!.pct}
              </span>
            )}
          </div>
          {showTier && (
            <span className="mt-0.5 block text-[10px] font-medium text-foreground-subtle">
              {tierMeta(node.tier)!.label}
            </span>
          )}
          {node.body && (
            <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">
              {node.body}
            </span>
          )}
          {node.team.length > 0 && (
            <div className="mt-2 flex items-center justify-center -space-x-1.5 border-t border-border pt-2.5">
              {/* One avatar per person — collapse multiple roles for the same
                  user, listing all their roles in the tooltip. */}
              {(() => {
                const byUser = new Map<string, string[]>();
                for (const m of node.team) {
                  const key = m.username.toLowerCase();
                  byUser.set(key, [...(byUser.get(key) ?? []), m.role]);
                }
                return [...byUser.entries()].map(([key, roles]) => {
                  const person = rosterMap.get(key);
                  const username = person?.username ?? key;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={key}
                      src={person?.avatarUrl ?? `https://images.hive.blog/u/${username}/avatar`}
                      alt={username}
                      title={`${roles.join(", ")}: @${username}`}
                      className="h-6 w-6 rounded-full border-2 border-surface-elevated object-cover"
                    />
                  );
                });
              })()}
            </div>
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
              rosterMap={rosterMap}
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
  roster,
  isRoot,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  card: BoardCard;
  roster: Person[];
  isRoot: boolean;
  onClose: () => void;
  onSave: (id: string, patch: CardPatch) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body ?? "");
  const [tier, setTier] = useState<string | null>(card.tier);
  const [logoUrl, setLogoUrl] = useState<string | null>(card.logoUrl);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Team rows: the predefined ROLES always show (fixed label), plus any custom
  // roles already on the card, plus any the user adds. `fixed` roles keep a
  // static label; custom ones expose an editable role-name input + remove.
  type Row = { role: string; username: string; fixed: boolean };
  const [rows, setRows] = useState<Row[]>(() => {
    const byRole = new Map(card.team.map((t) => [t.role, t.username]));
    const fixed: Row[] = ROLES.map((r) => ({ role: r, username: byRole.get(r) ?? "", fixed: true }));
    const custom: Row[] = card.team
      .filter((t) => !ROLES.includes(t.role as (typeof ROLES)[number]))
      .map((t) => ({ role: t.role, username: t.username, fixed: false }));
    return [...fixed, ...custom];
  });
  const [confirmDel, setConfirmDel] = useState(false);

  const kind = nodeKind(card);
  const rosterByUser = new Map(roster.map((p) => [p.username.toLowerCase(), p]));
  const teamArr: TeamMember[] = rows
    .map((r) => ({ role: r.role.trim(), username: r.username.trim() }))
    .filter((m) => m.role && m.username);
  const dirty =
    title !== card.title ||
    body !== (card.body ?? "") ||
    tier !== card.tier ||
    logoUrl !== card.logoUrl ||
    JSON.stringify(teamArr) !== JSON.stringify(card.team);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRole = () => setRows((prev) => [...prev, { role: "", username: "", fixed: false }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    const res = await uploadSopaLogo(file);
    setUploading(false);
    if (res.ok) setLogoUrl(res.url);
    else setUploadErr(res.error);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
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

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Logo</label>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <ImagePlus className="h-5 w-5 text-foreground-faint" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} className="hidden" />
            <button
              type="button"
              disabled={uploading || busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {logoUrl ? "Trocar logo" : "Enviar logo"}
            </button>
            {logoUrl && (
              <button
                type="button"
                onClick={() => setLogoUrl(null)}
                className="w-fit text-[11px] text-foreground-muted hover:text-danger"
              >
                Remover
              </button>
            )}
          </div>
        </div>
        {uploadErr && <p className="mb-3 text-xs text-danger">{uploadErr}</p>}

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Nome</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        {kind === "client" && (
          <>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">
              Tier de trabalho
            </label>
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTier(null)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  tier === null
                    ? "border-border-strong bg-surface-elevated text-foreground"
                    : "border-border text-foreground-muted hover:border-border-strong"
                }`}
              >
                Nenhum
              </button>
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    tier === t.id
                      ? "border-sky-400/50 bg-sky-400/10 text-sky-600 dark:text-sky-300"
                      : "border-border text-foreground-muted hover:border-border-strong"
                  }`}
                >
                  {t.label} · {t.pct}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
          Time <span className="text-foreground-faint">(membros dos projetos)</span>
        </label>
        <div className="mb-2 space-y-2">
          {rows.map((row, i) => {
            const selected = rosterByUser.get(row.username.toLowerCase());
            return (
              <div key={`${row.fixed ? "fixed" : "custom"}-${i}`} className="flex items-center gap-2">
                {row.fixed ? (
                  <span className="w-40 shrink-0 text-[11px] text-foreground-subtle">{row.role}</span>
                ) : (
                  <input
                    value={row.role}
                    onChange={(e) => setRow(i, { role: e.target.value })}
                    placeholder="Papel"
                    className="w-40 shrink-0 rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11px] text-foreground focus:border-border-strong focus:outline-none"
                  />
                )}
                {selected ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.avatarUrl}
                    alt=""
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-border" />
                )}
                <select
                  value={row.username}
                  onChange={(e) => setRow(i, { username: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
                >
                  <option value="">—</option>
                  {roster.map((p) => (
                    <option key={p.username} value={p.username}>
                      @{p.username}
                    </option>
                  ))}
                </select>
                {!row.fixed && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label="Remover papel"
                    className="shrink-0 rounded-md p-1 text-foreground-faint hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addRole}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted transition hover:border-accent-border hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar papel
        </button>

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Detalhes</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Notas, links…"
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
            onClick={() =>
              onSave(card.id, {
                title,
                body,
                tier: kind === "client" ? tier : null,
                team: teamArr,
                logoUrl,
              })
            }
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
