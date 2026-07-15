"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, X, Trash2, Check, Loader2, ImagePlus, DollarSign, Globe, Code2, RefreshCw } from "lucide-react";
import {
  type BoardCard,
  type TeamMember,
  type RevenueStream,
  type RevenueKind,
  type RevenueBalance,
  type OrgRepoOption,
  createCard,
  updateCard,
  deleteCard,
  listOrgRepos,
  getRevenueBalances,
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

const githubHref = (v: string) => (v.startsWith("http") ? v : `https://github.com/${v}`);

// EVM chains a receiving address can be tracked on (mirrors treasury.ts).
const REVENUE_CHAINS = ["base", "ethereum", "optimism", "arbitrum"] as const;
const REVENUE_KIND_LABEL: Record<RevenueKind, string> = {
  manual: "Manual",
  wallet: "Wallet",
  contract: "Contrato",
  split: "Split",
};
// Same key the server (getRevenueBalances) uses to map a balance back to a row.
const balanceKey = (chain: string | null, address: string) => `${chain ?? "all"}:${address.trim().toLowerCase()}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

export type Person = { username: string; avatarUrl: string; profileUrl: string };

type CardPatch = {
  title?: string;
  body?: string;
  tier?: string | null;
  team?: TeamMember[];
  logoUrl?: string | null;
  revenueStreams?: RevenueStream[];
  website?: string | null;
  githubOrg?: string | null;
  repos?: string[];
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
          {node.revenueStreams.length > 0 && (
            <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-left">
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <DollarSign className="h-2.5 w-2.5" /> Receita
              </span>
              {node.revenueStreams.slice(0, 4).map((s, i) => (
                <span
                  key={i}
                  className="block truncate text-[10px] text-foreground-muted"
                  title={s.detail ? `${s.label} — ${s.detail}` : s.label}
                >
                  • {s.label}
                  {s.detail ? <span className="text-foreground-faint"> · {s.detail}</span> : null}
                </span>
              ))}
              {node.revenueStreams.length > 4 && (
                <span className="block text-[10px] text-foreground-faint">
                  +{node.revenueStreams.length - 4} mais
                </span>
              )}
            </div>
          )}
        </button>

        {(node.website || node.githubOrg || node.repos.length > 0) && (
          <div className="flex items-center gap-2">
            {node.website && (
              <a
                href={node.website}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={node.website}
                className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-accent"
              >
                <Globe className="h-3 w-3" /> site
              </a>
            )}
            {node.githubOrg && (
              <a
                href={githubHref(node.githubOrg)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={node.repos.length ? node.repos.join(", ") : node.githubOrg}
                className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-accent"
              >
                <Code2 className="h-3 w-3" /> {node.githubOrg}
                {node.repos.length > 0 && <span className="text-foreground-faint">· {node.repos.length} repo{node.repos.length > 1 ? "s" : ""}</span>}
              </a>
            )}
          </div>
        )}

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
  const [website, setWebsite] = useState(card.website ?? "");
  const [githubOrg, setGithubOrg] = useState(card.githubOrg ?? "");
  const [repos, setRepos] = useState<string[]>(() => card.repos);
  const [orgRepos, setOrgRepos] = useState<OrgRepoOption[]>([]);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoErr, setRepoErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Team rows: the predefined ROLES always show (fixed label), plus any custom
  // roles already on the card, plus any the user adds.
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
  const [revRows, setRevRows] = useState<RevenueStream[]>(() => card.revenueStreams);
  const [tab, setTab] = useState<"geral" | "time" | "receita">("geral");

  const kind = nodeKind(card);
  const rosterByUser = new Map(roster.map((p) => [p.username.toLowerCase(), p]));
  const teamArr: TeamMember[] = rows
    .map((r) => ({ role: r.role.trim(), username: r.username.trim() }))
    .filter((m) => m.role && m.username);
  const revArr: RevenueStream[] = revRows
    .map((r) => ({
      label: r.label.trim(),
      detail: r.detail?.trim() || null,
      kind: r.kind,
      chain: r.kind === "manual" ? null : r.chain,
      address: r.kind === "manual" ? null : r.address?.trim() || null,
    }))
    .filter((r) => r.label);
  const dirty =
    title !== card.title ||
    body !== (card.body ?? "") ||
    tier !== card.tier ||
    logoUrl !== card.logoUrl ||
    website.trim() !== (card.website ?? "") ||
    githubOrg.trim() !== (card.githubOrg ?? "") ||
    JSON.stringify([...repos].sort()) !== JSON.stringify([...card.repos].sort()) ||
    JSON.stringify(teamArr) !== JSON.stringify(card.team) ||
    JSON.stringify(revArr) !== JSON.stringify(card.revenueStreams);

  async function fetchRepos() {
    const org = githubOrg.trim();
    if (!org) return;
    setRepoLoading(true);
    setRepoErr(null);
    const r = await listOrgRepos(org);
    setRepoLoading(false);
    if (r.ok) setOrgRepos(r.repos);
    else setRepoErr(r.error);
  }
  const toggleRepo = (fullName: string) =>
    setRepos((prev) => (prev.includes(fullName) ? prev.filter((x) => x !== fullName) : [...prev, fullName]));

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRole = () => setRows((prev) => [...prev, { role: "", username: "", fixed: false }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const setRev = (i: number, patch: Partial<RevenueStream>) =>
    setRevRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRev = () =>
    setRevRows((prev) => [...prev, { label: "", detail: null, kind: "manual", chain: null, address: null }]);
  const removeRev = (i: number) => setRevRows((prev) => prev.filter((_, idx) => idx !== i));
  // Switching a row to a tracked kind defaults its chain to Base.
  const setRevKind = (i: number, kind: RevenueKind) =>
    setRev(i, { kind, chain: kind === "manual" ? null : revRows[i].chain ?? "base" });

  // Live balances for tracked rows, keyed by chain:address.
  const [balances, setBalances] = useState<Record<string, RevenueBalance>>({});
  const [balLoading, setBalLoading] = useState(false);
  const tracked = revRows.filter((r) => r.kind !== "manual" && r.address?.trim());
  async function refreshBalances() {
    if (!tracked.length) return;
    setBalLoading(true);
    const r = await getRevenueBalances(tracked.map((t) => ({ chain: t.chain, address: t.address!.trim() })));
    setBalLoading(false);
    if (r.ok) setBalances(Object.fromEntries(r.balances.map((b) => [b.key, b])));
  }
  const trackedTotal = tracked.reduce((s, t) => s + (balances[balanceKey(t.chain, t.address!)]?.totalUsd ?? 0), 0);

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

  const teamCount = new Set(teamArr.map((t) => t.username)).size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl"
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

        {/* Tabs */}
        <div className="mb-4 flex items-center gap-1 border-b border-border">
          {(
            [
              ["geral", "Geral"],
              ["time", "Time"],
              ["receita", "Receita"],
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
                tab === id
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {lbl}
              {id === "time" && teamCount > 0 ? ` (${teamCount})` : ""}
              {id === "receita" && revArr.length > 0 ? ` (${revArr.length})` : ""}
            </button>
          ))}
        </div>

        {tab === "geral" && (
          <>
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

            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
              <Globe className="h-3.5 w-3.5" /> Website
            </label>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="mb-4 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />

            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
              <Code2 className="h-3.5 w-3.5" /> GitHub org
            </label>
            <div className="mb-2 flex gap-1.5">
              <input
                value={githubOrg}
                onChange={(e) => setGithubOrg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchRepos(); } }}
                placeholder="org ou usuário (ex: SkateHive)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
              />
              <button
                type="button"
                onClick={fetchRepos}
                disabled={!githubOrg.trim() || repoLoading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
              >
                {repoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
                Buscar repos
              </button>
            </div>
            {repoErr && <p className="mb-2 text-xs text-danger">{repoErr}</p>}

            {/* Currently-selected repos (persist even before a fresh fetch). */}
            {repos.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {repos.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRepo(r)}
                    className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-bg px-2 py-0.5 text-[10px] text-accent"
                    title={`Remover ${r}`}
                  >
                    {r} <X className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            )}

            {/* Fetched repo list to pick from. */}
            {orgRepos.length > 0 && (
              <div className="mb-4 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-surface-elevated p-2">
                <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-foreground-subtle">
                  Repos de {githubOrg.trim()} — marque os relevantes
                </p>
                {orgRepos.map((r) => {
                  const on = repos.includes(r.fullName);
                  return (
                    <label
                      key={r.fullName}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-surface"
                      title={r.description ?? r.fullName}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleRepo(r.fullName)} className="shrink-0" />
                      <span className={`min-w-0 flex-1 truncate ${on ? "text-foreground" : "text-foreground-muted"}`}>{r.name}</span>
                      {r.private && <span className="shrink-0 rounded bg-foreground/10 px-1 text-[9px] text-foreground-subtle">priv</span>}
                    </label>
                  );
                })}
              </div>
            )}
            {orgRepos.length === 0 && <div className="mb-2" />}

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

            <label className="mb-1 block text-xs font-medium text-foreground-muted">Detalhes</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Notas, links…"
              className="mb-4 w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
          </>
        )}

        {tab === "time" && (
          <>
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
          </>
        )}

        {tab === "receita" && (
          <>
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                <DollarSign className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Fontes de receita
              </label>
              {tracked.length > 0 && (
                <div className="flex items-center gap-2">
                  {Object.keys(balances).length > 0 && (
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">on-chain: {usd(trackedTotal)}</span>
                  )}
                  <button
                    type="button"
                    onClick={refreshBalances}
                    disabled={balLoading}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
                  >
                    {balLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} atualizar saldos
                  </button>
                </div>
              )}
            </div>

            <div className="mb-2 space-y-2">
              {revRows.map((r, i) => {
                const bal = r.kind !== "manual" && r.address?.trim() ? balances[balanceKey(r.chain, r.address)] : undefined;
                return (
                  <div key={i} className="rounded-lg border border-border bg-surface p-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={r.label}
                        onChange={(e) => setRev(i, { label: e.target.value })}
                        placeholder="Fonte (ex: Venda de zines, Split do serviço)"
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
                      />
                      <select
                        value={r.kind}
                        onChange={(e) => setRevKind(i, e.target.value as RevenueKind)}
                        className="shrink-0 rounded-md border border-border bg-surface-elevated px-1.5 py-1.5 text-[11px] text-foreground focus:border-border-strong focus:outline-none"
                      >
                        {(Object.keys(REVENUE_KIND_LABEL) as RevenueKind[]).map((k) => (
                          <option key={k} value={k}>{REVENUE_KIND_LABEL[k]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeRev(i)}
                        aria-label="Remover fonte"
                        className="shrink-0 rounded-md p-1 text-foreground-faint hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {r.kind === "manual" ? (
                      <input
                        value={r.detail ?? ""}
                        onChange={(e) => setRev(i, { detail: e.target.value })}
                        placeholder="Detalhe / valor (opcional)"
                        className="mt-1.5 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
                      />
                    ) : (
                      <div className="mt-1.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={r.chain ?? "all"}
                            onChange={(e) => setRev(i, { chain: e.target.value === "all" ? null : e.target.value })}
                            className="shrink-0 rounded-md border border-border bg-surface-elevated px-1.5 py-1.5 text-[11px] text-foreground focus:border-border-strong focus:outline-none"
                          >
                            <option value="all">todas chains</option>
                            {REVENUE_CHAINS.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <input
                            value={r.address ?? ""}
                            onChange={(e) => setRev(i, { address: e.target.value })}
                            placeholder="0x… (wallet, contrato ou split de recebimento)"
                            spellCheck={false}
                            className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-border-strong focus:outline-none"
                          />
                        </div>
                        {bal && (
                          <div className="flex items-center gap-2 px-0.5 text-[10px]">
                            {bal.error ? (
                              <span className="text-warning">{bal.error}</span>
                            ) : (
                              <>
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{usd(bal.totalUsd)}</span>
                                <span className="text-foreground-faint">
                                  {bal.tokens.map((t) => `${t.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${t.symbol}@${t.chain}`).join(" · ") || "sem saldo"}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {revRows.length === 0 && (
                <p className="text-[11px] text-foreground-faint">Nenhuma fonte de receita ainda.</p>
              )}
            </div>
            <button
              type="button"
              onClick={addRev}
              className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted transition hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar fonte de receita
            </button>
            <p className="mb-4 text-[10px] text-foreground-faint">
              Wallet / Contrato / Split mostram saldo ao vivo (ETH + USDC via RPC, igual ao /treasury). Split = endereço de um contrato 0xSplits de recebimento.
            </p>
          </>
        )}

        <div className="mt-2 flex items-center justify-between border-t border-border pt-4">
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
                revenueStreams: revArr,
                website: website.trim() || null,
                githubOrg: githubOrg.trim() || null,
                repos,
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
