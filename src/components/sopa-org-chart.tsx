"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Plus,
  X,
  Trash2,
  Check,
  Loader2,
  ImagePlus,
  DollarSign,
  Globe,
  Code2,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
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
  getRevenueTrends,
  getRevenueFlows,
  getRevenueRealized,
  type RevenueFlowResult,
  type RealizedRevenueResult,
} from "@/app/actions/sopa-boards";
import type { RevenueTrend } from "@/lib/revenue-snapshots";
import { uploadSopaLogo } from "@/lib/sopa-logo-upload";
import { Sparkline, RevenueChart } from "@/components/revenue-charts";
import { OrgCanvas, layoutTree, NODE_H, type Placed } from "@/components/org-chart-canvas";
import { useT } from "@/components/locale-provider";

// Engagement tiers + the roles defined for the agency. Stored on each node so a
// project rectangle shows its tier of work and who's on each role.
const TIERS = [
  { id: "pontual", label: "One-off", pct: "20%" },
  { id: "operacao", label: "Operation", pct: "30%" },
  { id: "motor", label: "Engine", pct: "40%" },
] as const;

const ROLES = [
  "Dev lead",
  "Marketing lead",
  "Design / Creative",
  "Community / Social",
  "Operations / Finance",
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
// On the canvas the card sits on a dotted plane, so its surface stays OPAQUE
// (a tinted translucent card lets the grid bleed through and reads as noise).
// The kind is carried by the left rail + title colour instead of a body tint.
const KIND_STYLE: Record<NodeKind, { wrap: string; title: string }> = {
  root: { wrap: "border-accent-border bg-surface", title: "text-accent" },
  native: { wrap: "border-border bg-surface", title: "text-foreground" },
  client: { wrap: "border-border bg-surface", title: "text-foreground" },
};

const githubHref = (v: string) => (v.startsWith("http") ? v : `https://github.com/${v}`);

// EVM chains a receiving address can be tracked on (mirrors treasury.ts).
const REVENUE_CHAINS = ["base", "ethereum", "optimism", "arbitrum"] as const;
const REVENUE_KIND_LABEL: Record<RevenueKind, string> = {
  manual: "Manual",
  wallet: "Wallet",
  contract: "Contract",
  split: "Split",
};
// Same key the server (getRevenueBalances) uses to map a balance back to a row.
const balanceKey = (chain: string | null, address: string) => `${chain ?? "all"}:${address.trim().toLowerCase()}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

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
  const t = useT().orgChart;
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Bumped by "collapse/expand all" — the one gesture that also means "and put
  // the cards I dragged back where they belong".
  const [resetToken, setResetToken] = useState(0);
  // The card that must not move when the tree reshapes. Folding a branch pins
  // the card you clicked; folding everything pins the root, which is the card
  // people read the whole chart from.
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const tree = useMemo(() => buildTree(cards), [cards]);
  const rosterMap = useMemo(
    () => new Map(roster.map((p) => [p.username.toLowerCase(), p])),
    [roster],
  );
  const parentOf = useMemo(
    () => new Map(cards.map((c) => [c.id, c.parentId])),
    [cards],
  );

  // Searching temporarily overrides collapse: a hit hidden inside a folded
  // branch would otherwise look like "no results".
  const q = query.trim().toLowerCase();
  const layout = useMemo(
    () => layoutTree(tree, q ? new Set<string>() : collapsed),
    [tree, collapsed, q],
  );

  // Search miss = faded, not removed, so the shape of the org stays readable.
  const dimmedIds = useMemo(() => {
    if (!q) return undefined;
    const miss = new Set<string>();
    for (const c of cards) {
      const hay = [
        c.title,
        c.body ?? "",
        ...c.team.map((t) => `${t.role} ${t.username}`),
        ...c.revenueStreams.map((s) => s.label),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) miss.add(c.id);
    }
    return miss;
  }, [cards, q]);
  const hits = q ? cards.length - (dimmedIds?.size ?? 0) : 0;

  // Root → focused chain, so the connectors light up the reporting line.
  // Hover leads (it's the cheap, exploratory gesture); the open card holds the
  // line when nothing is hovered.
  const activeEdgeIds = useMemo(() => {
    // Take the first candidate that still EXISTS in the current layout. Hover
    // leaves no trace when React unmounts a card — no pointerleave fires — so
    // collapsing a branch (or deleting a card) used to strand hoverId on a node
    // that was gone, and the open card's line stayed dark until you happened to
    // hover something else. Checking against the layout self-heals every path.
    const focus = [hoverId, openId, selectedId].find((id) => id && layout.byId.has(id));
    if (!focus) return undefined;
    const chain = new Set<string>();
    let cur: string | null | undefined = focus;
    while (cur) {
      chain.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return chain;
  }, [hoverId, openId, selectedId, parentOf, layout]);

  const openCard = cards.find((c) => c.id === openId) ?? null;
  const allParents = useMemo(
    () => cards.filter((c) => cards.some((x) => x.parentId === c.id)).map((c) => c.id),
    [cards],
  );
  const allCollapsed = allParents.length > 0 && allParents.every((id) => collapsed.has(id));

  const peopleCount = useMemo(
    () => new Set(cards.flatMap((c) => c.team.map((t) => t.username.toLowerCase()))).size,
    [cards],
  );
  const streamCount = useMemo(
    () => cards.reduce((n, c) => n + c.revenueStreams.length, 0),
    [cards],
  );

  function toggleCollapse(id: string) {
    setAnchorId(id);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rootId = useMemo(() => cards.find((c) => c.parentId === null)?.id ?? null, [cards]);

  function addChild(parentId: string, title: string) {
    setAnchorId(parentId);
    // A new child inside a folded branch would vanish — unfold as we add.
    setCollapsed((prev) => {
      if (!prev.has(parentId)) return prev;
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
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
      setSelectedId(null);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            {t.eyebrow}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-subtle">
            <span>{t.stats.cards(cards.length)}</span>
            <span className="text-foreground-faint">·</span>
            <span>{t.stats.people(peopleCount)}</span>
            <span className="text-foreground-faint">·</span>
            <span>{t.stats.streams(streamCount)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && (
            <span className="flex items-center gap-1.5 text-xs text-foreground-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.saving}
            </span>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search.placeholder}
              className="w-56 rounded-full border border-border bg-surface py-1.5 pl-8 pr-8 text-xs text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t.search.clear}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-faint hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {/* The count belongs to the field that produced it — in the dock it
                was a readout wedged among controls. */}
            {q && (
              <span
                aria-live="polite"
                className="absolute right-0 top-full mt-1 pr-3 text-[10px] font-semibold text-accent"
              >
                {t.search.hits(hits)}
              </span>
            )}
          </div>
        </div>
      </div>

      <OrgCanvas
        layout={layout}
        resetToken={resetToken}
        anchorId={anchorId}
        activeEdgeIds={activeEdgeIds}
        dimmedIds={dimmedIds}
        emptyHint={<p className="text-sm text-foreground-faint">{t.canvas.empty}</p>}
        dockExtra={[
          {
            key: "fold-all",
            // A query forces every branch open, so the control would flip its
            // own icon and move nothing on screen.
            disabled: !!q,
            label: q
              ? t.canvas.foldWhileSearching
              : allCollapsed
                ? t.canvas.expandAll
                : t.canvas.collapseAll,
            icon: allCollapsed ? (
              <ChevronsUpDown className="h-4 w-4" />
            ) : (
              <ChevronsDownUp className="h-4 w-4" />
            ),
            onClick: () => {
              setAnchorId(rootId);
              setCollapsed(allCollapsed ? new Set() : new Set(allParents));
              setResetToken((n) => n + 1);
            },
          },
          { key: "sep-fold", separator: true },
        ]}
        renderNode={(p) => (
          <OrgNodeCard
            placed={p}
            rosterMap={rosterMap}
            selected={openId === p.id || selectedId === p.id}
            onSelect={setSelectedId}
            onHover={setHoverId}
            onOpen={setOpenId}
            onToggleCollapse={toggleCollapse}
            onAddChild={addChild}
            searching={!!q}
            disabled={pending}
          />
        )}
      />

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
    </div>
  );
}

/** Avatars of everyone assigned to a card, capped so the row never wraps. */
function TeamStack({
  team,
  rosterMap,
  noTeamLabel,
}: {
  team: TeamMember[];
  rosterMap: Map<string, Person>;
  noTeamLabel: string;
}) {
  const people = useMemo(() => {
    const seen = new Set<string>();
    return team
      .filter((t) => {
        const k = t.username.trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((t) => ({ ...t, person: rosterMap.get(t.username.trim().toLowerCase()) }));
  }, [team, rosterMap]);

  if (people.length === 0) {
    return <span className="text-[10px] text-foreground-faint">{noTeamLabel}</span>;
  }
  const shown = people.slice(0, 4);
  return (
    // Spans, not divs: this renders inside the card's <button>, which may only
    // contain phrasing content.
    <span className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={m.username}
          src={m.person?.avatarUrl ?? `https://images.hive.blog/u/${m.username}/avatar`}
          alt={m.username}
          title={`${m.username} — ${m.role}`}
          className="h-5 w-5 rounded-full border border-surface bg-surface-elevated object-cover ring-1 ring-border"
        />
      ))}
      {people.length > shown.length && (
        <span className="flex h-5 items-center rounded-full border border-surface bg-surface-elevated pl-2 pr-1.5 text-[9px] font-semibold text-foreground-subtle ring-1 ring-border">
          +{people.length - shown.length}
        </span>
      )}
    </span>
  );
}

const KIND_RAIL: Record<NodeKind, string> = {
  root: "bg-accent",
  native: "bg-accent/55",
  client: "bg-sky-400",
};

function OrgNodeCard({
  placed,
  rosterMap,
  selected,
  onSelect,
  onHover,
  onOpen,
  onToggleCollapse,
  onAddChild,
  searching,
  disabled,
}: {
  placed: Placed<Node>;
  rosterMap: Map<string, Person>;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onAddChild: (parentId: string, title: string) => void;
  /** A search is forcing every branch open — folding is suspended. */
  searching: boolean;
  disabled: boolean;
}) {
  const t = useT().orgChart;
  const node = placed.node;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const kind = nodeKind(node);
  const style = KIND_STYLE[kind];
  const tier = kind === "client" ? tierMeta(node.tier) : null;
  const childCount = node.children.length;

  function confirmAdd() {
    const t = draft.trim();
    if (t) onAddChild(node.id, t);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="group relative" style={{ height: NODE_H }}>
      <button
        type="button"
        onClick={() => {
          onSelect(node.id);
          onOpen(node.id);
        }}
        onPointerEnter={() => onHover(node.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(node.id)}
        onBlur={() => onHover(null)}
        className={`relative flex h-full w-full cursor-grab flex-col justify-between overflow-hidden rounded-2xl border p-3.5 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md ${style.wrap} ${
          selected ? "border-accent-border ring-2 ring-accent/60" : "hover:border-border-strong"
        }`}
      >
        <span className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full ${KIND_RAIL[kind]}`} />

        <span className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
            {node.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={node.logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
            ) : (
              <span className="text-xs font-bold uppercase text-foreground-faint">
                {node.title.trim().slice(0, 2)}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={`truncate text-[13.5px] font-semibold leading-tight ${style.title}`}>
                {node.title}
              </span>
              {tier && (
                <span className="shrink-0 rounded-full bg-sky-400/15 px-1.5 py-px text-[9px] font-bold tracking-wide text-sky-600 dark:text-sky-300">
                  {tier.pct}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11px] leading-snug text-foreground-subtle">
              {node.body || tier?.label || t.kinds[kind]}
            </span>
          </span>
        </span>

        <span className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <TeamStack team={node.team} rosterMap={rosterMap} noTeamLabel={t.node.noTeam} />
          <span className="flex shrink-0 items-center gap-1.5">
            {node.revenueStreams.length > 0 && (
              <span
                title={node.revenueStreams.map((s) => s.label).join(", ")}
                className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
              >
                <DollarSign className="h-2.5 w-2.5" />
                {node.revenueStreams.length}
              </span>
            )}
            {node.repos.length > 0 && (
              <span
                title={node.repos.join(", ")}
                className="inline-flex items-center gap-0.5 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-semibold text-foreground-subtle"
              >
                <Code2 className="h-2.5 w-2.5" />
                {node.repos.length}
              </span>
            )}
            {node.website && <Globe className="h-3 w-3 text-foreground-faint" />}
          </span>
        </span>
      </button>

      {/* Fold/unfold the branch. Always visible when there are children — the
          count is information, not just a control. */}
      {childCount > 0 && (
        <button
          type="button"
          onClick={() => onToggleCollapse(node.id)}
          disabled={searching}
          aria-expanded={!placed.collapsed}
          aria-label={
            searching
              ? t.canvas.foldWhileSearching
              : placed.collapsed
                ? t.node.expand(node.title)
                : t.node.collapse(node.title)
          }
          title={searching ? t.canvas.foldWhileSearching : undefined}
          className="absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 text-[10px] font-semibold text-foreground-muted shadow-sm transition hover:border-accent-border hover:text-accent disabled:pointer-events-none disabled:opacity-45"
        >
          {placed.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {childCount}
        </button>
      )}

      {/* Add a child — revealed on hover so the canvas stays quiet at rest. */}
      {!adding && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAdding(true)}
          aria-label={t.node.addUnder(node.title)}
          title={t.node.addUnder(node.title)}
          className="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-dashed border-border bg-surface text-foreground-faint opacity-0 shadow-sm transition hover:border-accent-border hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}

      {adding && (
        <div className="absolute left-1/2 top-full z-20 mt-4 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
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
            placeholder={t.node.namePlaceholder}
            className="w-36 rounded-lg border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={confirmAdd}
            aria-label={t.node.add}
            className="rounded-lg border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
            aria-label={t.node.cancel}
            className="rounded-lg border border-border p-1 text-foreground-muted hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
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
  const [confirmClose, setConfirmClose] = useState(false);
  const t = useT().orgChart;

  // The body stops scrolling behind the drawer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
      credit: r.credit ?? [],
    }))
    .filter((r) => r.label);
  // Both sides get canonicalised before comparison, and that is NOT cosmetic:
  // the editor rebuilds the team in ROLES order and trims/normalises every
  // revenue row, so a card stored in another order — or with an untrimmed
  // detail, or a chain left on a manual row — read as edited the moment it was
  // opened. That used to only light up the Save button, which was harmless.
  // Now `dirty` also decides whether closing asks to discard, and a false
  // positive means being interrogated about a card you never touched.
  const canonTeam = (list: TeamMember[]) =>
    JSON.stringify(
      list
        .map((m) => ({ role: m.role.trim(), username: m.username.trim() }))
        .filter((m) => m.role && m.username)
        // Roles are a set, not a sequence — order carries no meaning here.
        .sort((a, b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username)),
    );
  // Revenue rows DO have a meaningful order (the user arranges them), so these
  // are normalised entry by entry and left in place.
  const canonRev = (list: RevenueStream[]) =>
    JSON.stringify(
      list
        .map((r) => ({
          label: r.label.trim(),
          detail: r.detail?.trim() || null,
          kind: r.kind,
          chain: r.kind === "manual" ? null : r.chain,
          address: r.kind === "manual" ? null : r.address?.trim() || null,
        }))
        .filter((r) => r.label),
    );

  const dirty =
    title !== card.title ||
    body !== (card.body ?? "") ||
    tier !== card.tier ||
    logoUrl !== card.logoUrl ||
    website.trim() !== (card.website ?? "").trim() ||
    githubOrg.trim() !== (card.githubOrg ?? "").trim() ||
    JSON.stringify([...repos].sort()) !== JSON.stringify([...card.repos].sort()) ||
    canonTeam(teamArr) !== canonTeam(card.team) ||
    canonRev(revArr) !== canonRev(card.revenueStreams);

  // Every way out of this drawer goes through here. The component already knew
  // there were unsaved edits — it renders an "unsaved" badge for exactly that
  // state — while Escape and the backdrop closed regardless and took the edits
  // with them. Now they ask, in the same two-step shape the delete button uses.
  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A second Escape confirms what the first one asked.
      if (confirmClose) onClose();
      else requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmClose, onClose, requestClose]);

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
    setRevRows((prev) => [...prev, { label: "", detail: null, kind: "manual", chain: null, address: null, credit: [] }]);
  const removeRev = (i: number) => setRevRows((prev) => prev.filter((_, idx) => idx !== i));
  // Switching a row to a tracked kind defaults its chain to Base.
  const setRevKind = (i: number, kind: RevenueKind) =>
    setRev(i, { kind, chain: kind === "manual" ? null : revRows[i].chain ?? "base" });

  // Live balances + historical trends for tracked rows, keyed by chain:address.
  const [balances, setBalances] = useState<Record<string, RevenueBalance>>({});
  const [trends, setTrends] = useState<Record<string, RevenueTrend>>({});
  const [flows, setFlows] = useState<Record<string, RevenueFlowResult>>({});
  const [realized, setRealized] = useState<Record<string, RealizedRevenueResult>>({});
  const [balLoading, setBalLoading] = useState(false);
  const tracked = revRows.filter((r) => r.kind !== "manual" && r.address?.trim());
  async function refreshBalances() {
    if (!tracked.length) return;
    setBalLoading(true);
    const targets = tracked.map((t) => ({ chain: t.chain, address: t.address!.trim() }));
    const [r, f, rr] = await Promise.all([
      getRevenueBalances(targets),
      getRevenueFlows(targets).catch(() => null),
      getRevenueRealized(targets).catch(() => null),
    ]);
    if (r.ok) {
      setBalances(Object.fromEntries(r.balances.map((b) => [b.key, b])));
      const currentUsd = Object.fromEntries(r.balances.map((b) => [b.key, b.totalUsd]));
      const t = await getRevenueTrends(card.id, currentUsd).catch(() => null);
      if (t?.ok) setTrends(Object.fromEntries(t.trends.map((x) => [x.key, x])));
    }
    if (f?.ok) setFlows(Object.fromEntries(f.flows.map((x) => [x.key, x])));
    if (rr?.ok) setRealized(Object.fromEntries(rr.realized.map((x) => [x.key, x])));
    setBalLoading(false);
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
    // A side drawer, not a centred modal: editing a card is a long form, and a
    // drawer keeps the chart itself on screen so you never lose your place in
    // the structure you're editing.
    <div
      className="org-scrim fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={t.drawer.label(card.title)}
    >
      <div
        className="org-drawer flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
            ) : (
              <span className="text-xs font-bold uppercase text-foreground-faint">
                {(title.trim() || "?").slice(0, 2)}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{title.trim() || t.drawer.untitled}</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
              <span className={`h-1.5 w-1.5 rounded-full ${KIND_RAIL[kind]}`} />
              {t.kinds[kind]}
              {dirty && <span className="text-warning">{t.drawer.unsaved}</span>}
            </p>
          </div>
          {/* The card itself can't carry these (a link inside a button is invalid
              markup), so the drawer header is where site/repo actually open. */}
          {website.trim() && (
            <a
              href={website.trim()}
              target="_blank"
              rel="noopener noreferrer"
              title={website.trim()}
              aria-label={t.drawer.openSite}
              className="rounded-lg p-1.5 text-foreground-muted transition hover:bg-surface-elevated hover:text-accent"
            >
              <Globe className="h-4 w-4" />
            </a>
          )}
          {githubOrg.trim() && (
            <a
              href={githubHref(githubOrg.trim())}
              target="_blank"
              rel="noopener noreferrer"
              title={githubOrg.trim()}
              aria-label={t.drawer.openGithub}
              className="rounded-lg p-1.5 text-foreground-muted transition hover:bg-surface-elevated hover:text-accent"
            >
              <Code2 className="h-4 w-4" />
            </a>
          )}
          <button
            type="button"
            onClick={requestClose}
            aria-label={t.drawer.close}
            className="rounded-lg p-1.5 text-foreground-muted transition hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Tabs */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-5">
          {(
            [
              ["geral", "General"],
              ["time", "Team"],
              ["receita", "Revenue"],
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                    Remove
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
                placeholder="org or user (e.g. SkateHive)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
              />
              <button
                type="button"
                onClick={fetchRepos}
                disabled={!githubOrg.trim() || repoLoading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
              >
                {repoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
                Fetch repos
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
                    title={`Remove ${r}`}
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
                    None
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
                        aria-label="Remove role"
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
                Revenue sources
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
                        placeholder="Source (e.g. Zine sales, Service split)"
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
                        aria-label="Remove source"
                        className="shrink-0 rounded-md p-1 text-foreground-faint hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* QUEM TROUXE. É o que transforma receita medida em mérito
                        na votação semanal: o portal já sabe quanto cada fonte
                        rendeu, e faltava saber de quem. Aceita dupla e trio; o
                        mérito é dividido por igual entre os marcados. Ninguém
                        marcado é resposta legítima — fonte sem dono claro não
                        gera mérito, o que é melhor que inventar um. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
                        trouxe
                      </span>
                      {roster.map((m) => {
                        const u = m.username.toLowerCase();
                        const on = (r.credit ?? []).includes(u);
                        return (
                          <button
                            key={u}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setRev(i, {
                                credit: on
                                  ? (r.credit ?? []).filter((x) => x !== u)
                                  : [...(r.credit ?? []), u],
                              })
                            }
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                              on
                                ? "border-accent-border bg-accent-bg text-accent"
                                : "border-border text-foreground-faint hover:border-border-strong hover:text-foreground-muted"
                            }`}
                          >
                            @{m.username}
                          </button>
                        );
                      })}
                      {(r.credit ?? []).length > 1 && (
                        <span className="ml-1 text-[10px] text-foreground-faint">
                          dividido por igual entre {(r.credit ?? []).length}
                        </span>
                      )}
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
                            placeholder="0x… (wallet, contract or receiving split)"
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
                                <span className="truncate text-foreground-faint">
                                  {bal.tokens.map((t) => `${t.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${t.symbol}@${t.chain}`).join(" · ") || "no balance"}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                        {(() => {
                          const key = r.address?.trim() ? balanceKey(r.chain, r.address) : "";
                          const tr = key ? trends[key] : undefined;
                          if (!tr || tr.points.length < 2) return null;
                          const chip = (label: string, v: number | null) =>
                            v == null ? null : (
                              <span className={v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-danger"}>
                                {label} {signedUsd(v)}
                              </span>
                            );
                          return (
                            <div className="flex items-center gap-2 px-0.5 text-[10px] text-foreground-faint">
                              <Sparkline points={tr.points} />
                              {chip("7d", tr.delta7d)}
                              {chip("30d", tr.delta30d)}
                            </div>
                          );
                        })()}
                        {(() => {
                          const key = r.address?.trim() ? balanceKey(r.chain, r.address) : "";
                          if (!key) return null;
                          const rr = realized[key];
                          const fl = flows[key];
                          // Auction/split → accurate event-based revenue (no refund/spend noise).
                          if (rr && rr.method !== "none" && rr.count > 0) {
                            const label = rr.method === "auction" ? `${rr.count} auctions` : `${rr.count} distributions`;
                            const title = rr.method === "auction" ? "Auction revenue" : "Distributed (split)";
                            return (
                              <div className="mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                                  <span className="text-foreground-muted">{rr.method === "auction" ? "🔨" : "💧"} {title} <span className="font-semibold text-emerald-600 dark:text-emerald-400">{usd(rr.revenueUsd)}</span></span>
                                  <span className="text-foreground-faint">{label}</span>
                                  {bal && <span className="text-foreground-muted">· dentro agora <span className="font-semibold text-foreground">{usd(bal.totalUsd)}</span></span>}
                                  {rr.truncated && <span className="text-warning">parcial</span>}
                                </div>
                                <RevenueChart series={rr.series} />
                              </div>
                            );
                          }
                          // Wallet / other → gross in/out flows (rough proxy).
                          if (!fl || fl.error) return null;
                          return (
                            <div className="mt-1 rounded-md border border-border bg-surface-elevated p-2">
                              <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                                <span className="text-foreground-muted">Recebido <span className="font-semibold text-emerald-600 dark:text-emerald-400">{usd(fl.receivedUsd)}</span></span>
                                <span className="text-foreground-muted">Pago/saiu <span className="font-semibold text-foreground">{usd(fl.paidUsd)}</span></span>
                                {bal && <span className="text-foreground-muted">Dentro <span className="font-semibold text-foreground">{usd(bal.totalUsd)}</span></span>}
                                {fl.truncated && <span className="text-warning" title="long history — showing part">partial</span>}
                              </div>
                              <RevenueChart series={fl.series} />
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
              {revRows.length === 0 && (
                <p className="text-[11px] text-foreground-faint">No revenue source yet.</p>
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
              Wallet / Contract / Split show a live balance (ETH + USDC via RPC, same as /treasury). Split = the address of a receiving 0xSplits contract.
            </p>
          </>
        )}

        </div>

        {/* Saving while the ask is up settles it — there's nothing left to
            discard, so the question retires itself. */}
        {confirmClose && dirty && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-warning/30 bg-warning/10 px-5 py-2.5">
            <span className="text-xs font-medium text-foreground">{t.drawer.discardTitle}</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-strong"
              >
                {t.drawer.keepEditing}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20"
              >
                {t.drawer.discard}
              </button>
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
          {!isRoot ? (
            confirmDel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(card.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Confirm deletion
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
            <span className="text-[11px] text-foreground-faint">The root can&apos;t be deleted</span>
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
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
