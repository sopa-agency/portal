"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  MessageSquare,
  Pencil,
  Plus,
  Archive,
  Send,
  Sparkles,
  Tag,
  Trash2,
  X,
  GripVertical,
  FlaskConical,
  CheckCheck,
  Undo2,
  Crown,
  Link2,
  Check,
  Eye,
} from "lucide-react";
import type { KanbanResult, KanbanColumn, KanbanItem } from "@/lib/github-project";
import type { BountyDTO } from "@/app/actions/bounty";
import { MarkdownContent } from "@/components/markdown-content";
import { BountyBadge, BountyPanel, ExecMeetingButton, taskKeyOf } from "@/components/bounty-panel";
import { MemberModal, type TeamMember } from "@/components/team-view";
import { solveIssueWithAgent, listCardNotes, addCardNote, deleteCardNote, type CardNote } from "@/app/actions/kanban";
import { CATEGORY_LABELS, TEST_NEEDS, TEST_PASSED, type LabelSpec } from "@/lib/kanban-labels";
import { useKanbanFxEnabled } from "@/lib/kanban-fx-pref";
import { FirePriority, DeadlineChip } from "@/components/card-indicators";
import { requestCardTest, resolveCardTest } from "@/app/actions/card-test";
import { useDialogA11y } from "@/hooks/use-dialog-a11y";
import { useConfirm } from "@/components/confirm-dialog";

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

// FirePriority + DeadlineChip live in card-indicators (re-exported below) so the
// team-view can use them without a circular import with this module.
export { FirePriority, DeadlineChip } from "@/components/card-indicators";

// ---------------------------------------------------------------------------
// Card body (shared by sortable card + drag overlay)
// ---------------------------------------------------------------------------

function CardBody({
  item,
  bounty,
  memberForLogin,
  onOpenMember,
}: {
  item: KanbanItem;
  bounty?: BountyDTO;
  memberForLogin?: (login: string) => TeamMember | null;
  onOpenMember?: (member: TeamMember) => void;
}) {
  const MAX_AVATARS = 3;
  const owner = item.owner?.toLowerCase();
  // Owner first so they're always shown (and bigger/highlighted).
  const ordered = owner
    ? [...item.assignees].sort((a, b) =>
        a.login.toLowerCase() === owner ? -1 : b.login.toLowerCase() === owner ? 1 : 0,
      )
    : item.assignees;
  const visible = ordered.slice(0, MAX_AVATARS);
  const extra = ordered.length - visible.length;
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
        {bounty && <BountyBadge bounty={bounty} />}
        <FirePriority value={item.firePriority} />
        <DeadlineChip value={item.deadline} />
        {item.assignees.length > 0 && (
          <div className="ml-auto flex items-center -space-x-1.5">
            {visible.map((a) => {
              const member = memberForLogin?.(a.login) ?? null;
              const isOwner = !!owner && a.login.toLowerCase() === owner;
              const avatar = (
                <span className={`relative inline-block ${isOwner ? "z-10" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.avatarUrl}
                    alt={a.login}
                    title={member ? `${isOwner ? "Dono · " : ""}@${member.username}` : `${isOwner ? "Dono · " : ""}${a.login}`}
                    width={isOwner ? 28 : 22}
                    height={isOwner ? 28 : 22}
                    className={`rounded-full object-cover ${isOwner ? "h-7 w-7 ring-2 ring-accent" : "h-[22px] w-[22px] ring-2 ring-surface-elevated"}`}
                  />
                  {isOwner && (
                    <Crown className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 fill-accent text-accent drop-shadow" aria-label="Dono" />
                  )}
                </span>
              );
              return member && onOpenMember ? (
                <button
                  key={a.login}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMember(member);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="rounded-full transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent"
                  aria-label={`Open @${member.username} contact card`}
                >
                  {avatar}
                </button>
              ) : (
                <span key={a.login}>{avatar}</span>
              );
            })}
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

// Deterministic icicle pattern (no hydration mismatch) for frozen cards.
// Fewer + irregular heights (a couple of long ones) reads more like real ice.
const ICICLES = [9, 24, 6, 16, 8, 28, 11, 19, 7, 13];

// Pre-rendered ember sprite (one offscreen canvas, reused for every particle —
// far cheaper than building a radial gradient per particle per frame).
let emberSprite: HTMLCanvasElement | null = null;
function getEmberSprite(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (emberSprite) return emberSprite;
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const x = c.getContext("2d");
  if (!x) return null;
  const g = x.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, "rgba(255,244,190,1)");
  g.addColorStop(0.35, "rgba(255,160,50,0.95)");
  g.addColorStop(1, "rgba(255,80,20,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 16, 16);
  emberSprite = c;
  return c;
}

/** Canvas 2D fire — inspired by the WebGL "sparks-drifting" / fire shaders but
 *  light enough to run per-card (no WebGL context limits). A dense, short-lived
 *  flame base (whose overlapping additive glow brightens to a hot core) plus
 *  sparser drifting sparks rising higher with a gentle sway. */
function FireCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    const sprite = getEmberSprite();
    if (!ctx || !sprite) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(canvas);

    type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };
    const flames: P[] = [];
    const sparks: P[] = [];
    const seedFlame = () => {
      if (!w || !h) return;
      flames.push({
        x: Math.random() * w,
        y: h + 2,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -(0.14 + Math.random() * 0.4),
        life: 0,
        max: 30 + Math.random() * 40,
        size: 2.0 + Math.random() * 2.6,
      });
    };
    const seedSpark = () => {
      if (!w || !h) return;
      sparks.push({
        x: Math.random() * w,
        y: h - 1,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -(0.4 + Math.random() * 0.85),
        life: 0,
        max: 70 + Math.random() * 70,
        size: 0.6 + Math.random() * 1.3,
      });
    };

    let raf = 0;
    let frame = 0;
    let running = true;
    const loop = () => {
      if (!running) return;
      frame++;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // Flame base — dense, soft, overlapping → bright hot core. Drawn taller
      // than wide + gently swaying so the base reads as flame tongues, not blobs.
      if (frame % 2 === 0 && flames.length < 52) seedFlame();
      for (let i = flames.length - 1; i >= 0; i--) {
        const p = flames[i];
        p.life++;
        p.vx += Math.sin((p.life + p.x) * 0.045) * 0.006; // organic sway
        p.x += p.vx;
        p.y += p.vy;
        const t = p.life / p.max;
        if (t >= 1) { flames.splice(i, 1); continue; }
        const b = p.size * (1 - t * 0.3);
        const rx = b * 3.0;
        const ry = b * 6.2; // vertical stretch → flame shape
        ctx.globalAlpha = (1 - t) * 0.42;
        ctx.drawImage(sprite, p.x - rx, p.y - ry, rx * 2, ry * 2);
      }

      // Drifting sparks — fewer, smaller, rise higher with a slow sway.
      if (frame % 6 === 0 && sparks.length < 13) seedSpark();
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life++;
        p.vx += Math.sin((p.life + p.x) * 0.045) * 0.008;
        p.x += p.vx;
        p.y += p.vy;
        p.vy *= 0.996;
        const t = p.life / p.max;
        if (t >= 1 || p.y < -6) { sparks.splice(i, 1); continue; }
        const r = p.size * (1 - t * 0.4) * 3.6;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      running = !document.hidden;
      if (running) loop();
    };
    document.addEventListener("visibilitychange", onVis);
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-0 h-full w-full" aria-hidden />;
}

// ── Electric border (ported from reactbits.dev/animations/electric-border) ──
// Canvas-drawn rounded-rect stroke displaced by octaved value-noise — a jittery
// "electric" outline. Used for frozen cards (icy color). Pure helpers + an
// overlay component (not a wrapper) so it drops onto the existing card.
const EB_OFFSET = 36; // px the canvas extends beyond the card (room for displacement)
function ebRandom(x: number) { return (Math.sin(x * 12.9898) * 43758.5453) % 1; }
function ebNoise2D(x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const a = ebRandom(i + j * 57), b = ebRandom(i + 1 + j * 57), c = ebRandom(i + (j + 1) * 57), d = ebRandom(i + 1 + (j + 1) * 57);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
function ebOctaved(x: number, amp: number, freq: number, time: number, seed: number) {
  let y = 0, amplitude = amp, frequency = freq;
  for (let i = 0; i < 10; i++) {
    y += amplitude * ebNoise2D(frequency * x + seed * 100, time * frequency * 0.3);
    frequency *= 1.6;
    amplitude *= 0.7;
  }
  return y;
}
function ebCorner(cx: number, cy: number, r: number, start: number, arc: number, p: number) {
  const a = start + p * arc;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function ebRoundedRectPoint(t: number, left: number, top: number, width: number, height: number, radius: number) {
  const sw = width - 2 * radius, sh = height - 2 * radius, arc = (Math.PI * radius) / 2;
  const total = 2 * sw + 2 * sh + 4 * arc, dist = t * total;
  let acc = 0;
  if (dist <= acc + sw) return { x: left + radius + (dist - acc), y: top };
  acc += sw;
  if (dist <= acc + arc) return ebCorner(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, (dist - acc) / arc);
  acc += arc;
  if (dist <= acc + sh) return { x: left + width, y: top + radius + (dist - acc) };
  acc += sh;
  if (dist <= acc + arc) return ebCorner(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, (dist - acc) / arc);
  acc += arc;
  if (dist <= acc + sw) return { x: left + width - radius - (dist - acc), y: top + height };
  acc += sw;
  if (dist <= acc + arc) return ebCorner(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, (dist - acc) / arc);
  acc += arc;
  if (dist <= acc + sh) return { x: left, y: top + height - radius - (dist - acc) };
  acc += sh;
  return ebCorner(left + radius, top + radius, radius, Math.PI, Math.PI / 2, (dist - acc) / arc);
}

function ElectricBorderCanvas({ color, speed, chaos, radius, glow = 6 }: { color: string; speed: number; chaos: number; radius: number; glow?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cw = 0, ch = 0;
    const resize = () => {
      const r = parent.getBoundingClientRect();
      cw = r.width + EB_OFFSET * 2;
      ch = r.height + EB_OFFSET * 2;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    let raf = 0, running = true, last = 0, time = 0;
    const draw = (now: number) => {
      if (!running) return;
      time += ((now - last) / 1000) * speed;
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      const left = EB_OFFSET, top = EB_OFFSET, bw = cw - 2 * EB_OFFSET, bh = ch - 2 * EB_OFFSET;
      const rad = Math.min(radius, Math.min(bw, bh) / 2);
      const perim = 2 * (bw + bh) + 2 * Math.PI * rad;
      const samples = Math.max(40, Math.floor(perim / 2));
      const scale = 26;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const p = i / samples;
        const pt = ebRoundedRectPoint(p, left, top, bw, bh, rad);
        const dx = ebOctaved(p * 8, chaos, 10, time, 0) * scale;
        const dy = ebOctaved(p * 8, chaos, 10, time, 1) * scale;
        if (i === 0) ctx.moveTo(pt.x + dx, pt.y + dy);
        else ctx.lineTo(pt.x + dx, pt.y + dy);
      }
      ctx.closePath();
      ctx.stroke();
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    const onVis = () => { running = !document.hidden; if (running && !reduce) { last = performance.now(); raf = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", onVis);
    last = performance.now();
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [color, speed, chaos, radius, glow]);
  // Canvas centered over the card, extending EB_OFFSET beyond each edge.
  return <canvas ref={ref} className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2" aria-hidden />;
}

/** Matches "done"-like column names (board status), in PT + EN. */
export function isDoneColumn(name?: string): boolean {
  return !!name && /done|conclu|complete|finaliz|shipped|closed|arquiv/i.test(name);
}

/**
 * Game-FX state for a card: overdue + NOT done → frozen; else 5🔥 → on fire.
 * "Done" is the card's column/status (a card still in In Review is NOT done) or
 * a closed issue/PR — not just the GitHub closed state.
 */
export function cardFxState(
  item: { firePriority?: number; deadline?: string; state?: string },
  done = false,
): { onFire: boolean; frozen: boolean } {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const isDone = done || item.state === "closed";
  const frozen = !!item.deadline && item.deadline < todayYmd && !isDone;
  const onFire = !frozen && item.firePriority === 5;
  return { onFire, frozen };
}

/** Decorative game overlay (pointer-events-none). Lives as a sibling of the card
 *  content — NOT on the card element — so the card's transition-all never fights
 *  the animation (which otherwise glitched on re-render after opening a card). */
export function CardFx({ onFire, frozen, radius = 12 }: { onFire: boolean; frozen: boolean; radius?: number }) {
  const fxEnabled = useKanbanFxEnabled();
  if (!fxEnabled || (!onFire && !frozen)) return null;
  return (
    <>
      {/* Animated electric outline — charred ember edge for fire, icy for frost. */}
      {onFire && <ElectricBorderCanvas color="#ff6a1a" speed={0.55} chaos={0.1} radius={radius} glow={11} />}
      {frozen && <ElectricBorderCanvas color="#7dd3fc" speed={0.1} chaos={0.06} radius={radius} />}

      {/* Fills, clipped to the card's rounded corners. */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]" aria-hidden>
        {onFire ? (
          <>
            <div className="absolute inset-x-0 bottom-0 h-3/4" style={{ background: "linear-gradient(to top, rgba(249,115,22,0.26), rgba(239,68,68,0.10) 45%, transparent)" }} />
            <FireCanvas />
          </>
        ) : (
          <>
            {/* full-card icy wash + a brighter frost at the top */}
            <div className="absolute inset-0" style={{ background: "rgba(125,211,252,0.14)" }} />
            <div className="absolute inset-0" style={{ background: "radial-gradient(120% 55% at 50% 0%, rgba(186,230,253,0.32), transparent 62%)" }} />
          </>
        )}
      </div>

      {/* Icicles hang in FRONT, from the top edge. */}
      {frozen && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-between overflow-hidden rounded-t-[inherit] px-1.5" aria-hidden>
          {ICICLES.map((h, i) => (
            <span key={i} className="kb-icicle block drop-shadow-[0_1px_1px_rgba(56,189,248,0.55)]" style={{ width: Math.max(5, Math.round(h * 0.42)), height: h }} />
          ))}
        </div>
      )}
    </>
  );
}

function SortableCard({
  item,
  bounty,
  done,
  onArchive,
  onDelete,
  onOpen,
  memberForLogin,
  onOpenMember,
  busy,
}: {
  item: KanbanItem;
  bounty?: BountyDTO;
  done?: boolean;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (item: KanbanItem) => void;
  memberForLogin?: (login: string) => TeamMember | null;
  onOpenMember?: (member: TeamMember) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  // Game FX: overdue + not-done → frozen; else top priority (5🔥) → on fire.
  // "done" = the card's column is a Done-like one (passed in) or it's closed.
  // Effects are an isolated overlay (CardFx), so the card element keeps its
  // original classes — no transition-all vs animation conflict on re-render.
  const { onFire, frozen } = cardFxState(item, done);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-xl border border-border bg-surface-elevated p-3 shadow-sm transition-all hover:border-border-strong hover:shadow-md"
    >
      <CardFx onFire={onFire} frozen={frozen} />
      {/* Drag handle + body */}
      <div className="relative z-10 flex items-start gap-1.5">
        <button
          type="button"
          aria-label="Mover card"
          className="-ml-1 mt-0.5 cursor-grab touch-none rounded p-0.5 text-foreground-faint opacity-100 transition-opacity hover:text-foreground active:cursor-grabbing [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(item)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(item);
            }
          }}
          aria-label={`Open ${item.title}`}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <CardBody item={item} bounty={bounty} memberForLogin={memberForLogin} onOpenMember={onOpenMember} />
        </div>
      </div>

      {/* Action buttons — appear on hover */}
      <div className="absolute right-1.5 top-1.5 z-30 flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated/95 p-0.5 opacity-100 shadow-sm backdrop-blur transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir no GitHub"
            className="rounded p-1 text-foreground-faint hover:bg-foreground/5 hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          aria-label="Arquivar"
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onArchive(item.id)}
          className="rounded p-1 text-foreground-faint hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Deletar"
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
  bountyByKey,
  onArchive,
  onDelete,
  onAddDraft,
  issueRepo,
  onOpen,
  memberForLogin,
  onOpenMember,
  busy,
}: {
  column: KanbanColumn;
  bountyByKey?: Map<string, BountyDTO>;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onAddDraft: (columnName: string, title: string, kind: "draft" | "issue") => void;
  /** owner/name of the board's primary repo — enables the "Issue" kind. */
  issueRepo?: string | null;
  onOpen: (item: KanbanItem) => void;
  memberForLogin?: (login: string) => TeamMember | null;
  onOpenMember?: (member: TeamMember) => void;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `container:${column.name}` });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<"draft" | "issue">("draft");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function submit() {
    const t = draft.trim();
    if (t) onAddDraft(column.name, t, kind);
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
          aria-label={`Adicionar card em ${column.name}`}
          onClick={() => setAdding((a) => !a)}
          className="rounded-md p-1 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-visible rounded-b-xl p-2 pt-0.5 transition-colors lg:overflow-y-auto ${
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
              placeholder={kind === "issue" ? "Título da issue… (Enter cria, Esc cancela)" : "Título do card… (Enter cria, Esc cancela)"}
              rows={2}
              className="w-full resize-none rounded-md bg-surface px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-faint focus:ring-1 focus:ring-accent-border"
            />
            <div className="mt-1.5 flex items-center justify-between gap-1.5">
              {issueRepo ? (
                <div className="flex gap-0.5 rounded-md bg-surface p-0.5">
                  {(["draft", "issue"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      title={k === "issue" ? `Creates a real issue in ${issueRepo}` : "Board-only draft card"}
                      className={`rounded px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide transition-colors ${
                        kind === k ? "bg-surface-elevated text-accent shadow-sm" : "text-foreground-faint hover:text-foreground"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setDraft(""); setAdding(false); }}
                className="rounded-md p-1 text-foreground-faint hover:bg-foreground/5 hover:text-foreground"
                aria-label="Cancelar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim()}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground disabled:opacity-50"
              >
                Adicionar
              </button>
              </div>
            </div>
          </div>
        )}

        <SortableContext items={column.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {column.items.length === 0 && !adding ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 py-8">
              <p className="text-xs text-foreground-faint">Solte os cards aqui</p>
            </div>
          ) : (
            column.items.map((item) => (
              <SortableCard
                key={item.id}
                item={item}
                bounty={bountyByKey?.get(taskKeyOf(item))}
                done={isDoneColumn(column.name)}
                onArchive={onArchive}
                onDelete={onDelete}
                onOpen={onOpen}
                memberForLogin={memberForLogin}
                onOpenMember={onOpenMember}
                busy={busy}
              />
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

/** Live progress while the coding agent solves an issue (a long gateway call,
 *  up to ~5min): elapsed timer + rotating captions so it reads as "working". */
function AgentSolveProgress() {
  const STEPS = [
    "Lendo a issue e o código do projeto…",
    "Criando uma branch e implementando…",
    "Rodando/checando a mudança…",
    "Commitando, dando push e abrindo o PR…",
  ];
  const [elapsed, setElapsed] = useState(0);
  const [step, setStep] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    if (startRef.current === 0) startRef.current = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    const s = setInterval(() => setStep((i) => (i + 1) % STEPS.length), 4000);
    return () => { clearInterval(t); clearInterval(s); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const secs = Math.floor(elapsed / 1000);
  return (
    <div className="rounded-lg border border-accent-border bg-accent-bg/40 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-accent">
        <Loader2 className="h-4 w-4 animate-spin" /> Agente resolvendo a issue…
      </div>
      <p className="mt-1 text-xs text-foreground-muted">{STEPS[step]}</p>
      <p className="mt-1 font-mono text-[11px] tabular-nums text-foreground-faint">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · pode levar alguns minutos — mantenha esta janela aberta
      </p>
    </div>
  );
}

/** Portal-side comments on a card — works on ANY card (incl. drafts, which have
 *  no GitHub issue). Stored in the portal DB, keyed by the board item id. */
function CardNotes({ projectSlug, cardKey, label = "Comentários" }: { projectSlug: string; cardKey: string; label?: string }) {
  const [notes, setNotes] = useState<CardNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listCardNotes(projectSlug, cardKey).then((r) => { if (live) setNotes(r.ok ? r.notes : []); });
    return () => { live = false; };
  }, [projectSlug, cardKey]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null);
    const r = await addCardNote(projectSlug, cardKey, text);
    setBusy(false);
    if (r.ok) { setNotes((p) => [...(p ?? []), r.note]); setDraft(""); }
    else setErr(r.error);
  }
  async function remove(id: string) {
    const r = await deleteCardNote(id);
    if (r.ok) setNotes((p) => (p ?? []).filter((n) => n.id !== id));
    else setErr(r.error);
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        <MessageSquare className="h-3.5 w-3.5" /> {label}{notes ? ` (${notes.length})` : ""}
      </p>
      {err && <p className="mb-2 text-xs text-danger">{err}</p>}
      {notes === null ? (
        <p className="flex items-center gap-2 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs italic text-foreground-faint">Sem comentários ainda.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="group rounded-xl border border-border bg-surface px-3 py-2">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
                <span className="font-semibold text-foreground-muted">@{n.author}</span> · {new Date(n.createdAt).toLocaleString()}
                <button type="button" onClick={() => remove(n.id)} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" title="Apagar">
                  <Trash2 className="h-3 w-3 text-foreground-faint hover:text-danger" />
                </button>
              </p>
              <p className="whitespace-pre-wrap text-[13px] text-foreground">{n.body}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          placeholder="Comentar nesta tarefa… (⌘+Enter envia)"
          rows={2}
          className="min-h-[44px] flex-1 resize-y rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
        />
        <button type="button" onClick={() => void send()} disabled={busy || !draft.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar
        </button>
      </div>
    </div>
  );
}

/** Derive "owner/repo" from a GitHub issue/PR URL for #N autolinking. */
function repoOf(url?: string): string | undefined {
  const m = url?.match(/github\.com\/([^/]+\/[^/]+)\//);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Test/QA request loop — request testing of an in-review card, then approve
// (→ Done) or reject (→ In Progress). Real issues/PRs only (labels + comments).
// ---------------------------------------------------------------------------

function CardTestSection({
  item,
  repo,
  team,
  statusCtx,
  onPatchItem,
}: {
  item: KanbanItem;
  repo: string | null;
  team: { login: string; avatarUrl: string; username: string | null }[];
  statusCtx?: { projectId: string; fieldId: string | null; columns: { name: string; optionId?: string }[] };
  onPatchItem: (itemId: string, patch: Partial<KanbanItem>) => void;
}) {
  const testers = useMemo(() => {
    const seen = new Set<string>();
    const out: { username: string; login: string; avatarUrl: string }[] = [];
    for (const t of team) {
      const u = t.username?.toLowerCase().trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push({ username: u, login: t.login, avatarUrl: t.avatarUrl });
    }
    return out;
  }, [team]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const canTest = item.type !== "draft" && !!item.contentId && !!repo;
  const needsTest = item.labels.some((l) => l.name.toLowerCase() === TEST_NEEDS);
  const tested = item.labels.some((l) => l.name.toLowerCase() === TEST_PASSED);

  if (!canTest) {
    if (item.type === "draft") {
      return (
        <p className="flex items-center gap-1.5 text-xs text-foreground-faint">
          <FlaskConical className="h-3.5 w-3.5" /> Converta em issue para solicitar um teste.
        </p>
      );
    }
    return null;
  }

  const toggle = (u: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u); else next.add(u);
      return next;
    });

  const cardUrl = typeof window !== "undefined" ? `${window.location.origin}/kanban?open=${encodeURIComponent(item.id)}` : "";
  const prUrl = item.type === "pr" ? item.url : null;

  async function request() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await requestCardTest({
        contentId: item.contentId,
        type: item.type,
        repo,
        title: item.title,
        cardUrl,
        prUrl,
        whatToTest: note.trim(),
        testers: [...selected],
      });
      if (r.ok) {
        onPatchItem(item.id, {
          labels: [
            ...item.labels.filter((l) => l.name.toLowerCase() !== TEST_PASSED),
            { name: TEST_NEEDS, color: "fbca04" },
          ],
        });
        setNote("");
        const extra = r.failed.length ? ` (falhou: ${r.failed.map((f) => `@${f}`).join(", ")})` : "";
        setResult({ ok: true, text: `Teste solicitado a ${r.delivered.map((d) => `@${d}`).join(", ") || "ninguém"}.${extra}` });
      } else {
        setResult({ ok: false, text: r.error });
      }
    } finally {
      setBusy(false);
    }
  }

  async function resolve(verdict: "pass" | "fail") {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const rx = verdict === "pass" ? /done|conclu|complete|finaliz|shipped|closed/i : /progress|doing|andamento|wip|fazendo/i;
      const targetOptionId = statusCtx?.columns.find((c) => rx.test(c.name))?.optionId ?? null;
      const r = await resolveCardTest({
        itemId: item.id,
        contentId: item.contentId,
        type: item.type,
        repo,
        projectId: statusCtx?.projectId,
        statusFieldId: statusCtx?.fieldId,
        targetOptionId,
        verdict,
        note: note.trim(),
        title: item.title,
      });
      if (r.ok) {
        onPatchItem(item.id, {
          labels: [
            ...item.labels.filter((l) => {
              const n = l.name.toLowerCase();
              return n !== TEST_NEEDS && n !== TEST_PASSED;
            }),
            ...(verdict === "pass" ? [{ name: TEST_PASSED, color: "0e8a16" }] : []),
          ],
        });
        setNote("");
        const moved = r.moved ? (verdict === "pass" ? " → movido para Done" : " → movido para In Progress") : " (mova a coluna manualmente)";
        setResult({ ok: true, text: `${verdict === "pass" ? "Aprovado ✅" : "Reprovado ↩️"}${moved}. Atualize para ver na coluna.` });
      } else {
        setResult({ ok: false, text: r.error });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        <FlaskConical className="h-3.5 w-3.5" /> Teste / QA
        {needsTest && <span className="ml-1 rounded-full bg-[#fbca04]/20 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[#a16207]">aguardando teste</span>}
        {tested && !needsTest && <span className="ml-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-success">testado</span>}
      </p>

      {needsTest ? (
        <div className="space-y-2.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Observações do teste (opcional)…"
            className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolve("pass")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Aprovar
            </button>
            <button
              type="button"
              onClick={() => resolve("fail")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Reprovar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {testers.length === 0 ? (
            <p className="text-xs text-foreground-faint">Nenhum membro do time com canal de mensagem pra escolher como testador.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {testers.map((t) => {
                const on = selected.has(t.username);
                return (
                  <button
                    key={t.username}
                    type="button"
                    onClick={() => toggle(t.username)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-medium transition-colors ${
                      on ? "border-accent-border bg-accent-bg text-accent" : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
                    @{t.username}
                  </button>
                );
              })}
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="O que testar / checklist (opcional)…"
            className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={request}
            disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            {selected.size > 0 ? `Solicitar teste (${selected.size})` : "Solicitar teste"}
          </button>
        </div>
      )}

      {result && <p className={`mt-2 text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>}
    </div>
  );
}

/** Markdown that renders inside a fixed default height; expands on "Ver mais". */
function CollapsibleMarkdown({ markdown, githubRepo }: { markdown: string; githubRepo?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [markdown]);
  return (
    <div>
      <div ref={ref} className={`relative overflow-hidden ${expanded ? "max-h-none" : "max-h-32"}`}>
        <MarkdownContent markdown={markdown} githubRepo={githubRepo ?? undefined} />
        {!expanded && overflows && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" />
        )}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-accent hover:underline"
        >
          {expanded ? "Ver menos" : "Ver mais"}
        </button>
      )}
    </div>
  );
}

export function CardDetailDialog({
  item,
  team,
  memberForLogin,
  projectSlug,
  canManage,
  bounty,
  onBountyChanged,
  issueRepo,
  statusCtx,
  onSetAssignees,
  onMutate,
  onPatchItem,
  onClose,
}: {
  item: KanbanItem;
  /** Assignable collaborators (with portal username when team-card-mapped). */
  team: { login: string; avatarUrl: string; username: string | null }[];
  memberForLogin: (login: string) => TeamMember | null;
  projectSlug?: string;
  canManage: boolean;
  bounty: BountyDTO | undefined;
  onBountyChanged: () => void | Promise<void>;
  /** Board's primary repo (owner/name) — enables draft→issue + solve-with-agent. */
  issueRepo?: string | null;
  /** Board status field + columns — lets the test loop move the card on approve/reject. */
  statusCtx?: { projectId: string; fieldId: string | null; columns: { name: string; optionId?: string }[] };
  onSetAssignees: (item: KanbanItem, logins: string[]) => Promise<void>;
  onMutate: MutateFn;
  onPatchItem: (itemId: string, patch: Partial<KanbanItem>) => void;
  onClose: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [manualLogin, setManualLogin] = useState("");
  // Assignable on any item with a content node id. The list may be empty (e.g. a
  // board whose repo collaborators aren't readable, or no configured repo) — the
  // manual "@login" input still lets you assign anyone with access/in the org.
  const canAssign = item.contentId != null;

  // --- edit mode (title/body — issues, PRs, drafts) ---
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftBody, setDraftBody] = useState(item.body ?? "");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // --- shareable deep link (/kanban?open=<id>) — the board also keeps this in
  // the URL bar, but a copy button makes it obvious the card IS shareable ---
  const [linkCopied, setLinkCopied] = useState(false);
  async function copyCardLink() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/kanban?open=${encodeURIComponent(item.id)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (permissions/insecure context) — drop the link in the
      // URL bar so the user can copy it from there instead.
      window.history.replaceState(window.history.state, "", `/kanban?open=${encodeURIComponent(item.id)}`);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  // --- draft→issue convert + solve-with-agent (issues) ---
  const [converting, setConverting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [solveBusy, setSolveBusy] = useState(false);
  const [solveRes, setSolveRes] = useState<{ prUrl: string | null; result: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function reopenCard() {
    if (!item.contentId || reopening) return;
    setReopening(true);
    setActionError(null);
    const r = await onMutate({ action: "reopen", contentId: item.contentId, itemType: item.type });
    setReopening(false);
    if (r.ok) onPatchItem(item.id, { state: "open" });
    else setActionError(r.error ?? "Falha ao reabrir.");
  }

  async function convertToIssue() {
    if (!issueRepo || converting) return;
    setConverting(true); setActionError(null);
    const r = (await onMutate({ action: "convertDraft", itemId: item.id, repo: issueRepo })) as {
      ok: boolean; error?: string; url?: string; contentId?: string; number?: number;
    };
    setConverting(false);
    if (r.ok) onPatchItem(item.id, { type: "issue", url: r.url, contentId: r.contentId, number: r.number, state: "open" });
    else setActionError(r.error ?? "Falha ao converter em issue.");
  }

  async function solveWithAgent() {
    if (solveBusy) return;
    setSolveBusy(true); setActionError(null); setSolveRes(null);
    const r = await solveIssueWithAgent({ title: item.title, body: item.body, url: item.url });
    setSolveBusy(false);
    if (r.ok) setSolveRes({ prUrl: r.prUrl, result: r.result });
    else setActionError(r.error);
  }

  // Generate (empty body) or improve (existing body) via the project agent.
  // Lands in the edit textarea for review — never saves on its own.
  async function aiAssist() {
    if (aiBusy) return;
    const title = (editing ? draftTitle : item.title).trim();
    if (!title) return;
    const current = editing ? draftBody : (item.body ?? "");
    if (!editing) {
      setDraftTitle(item.title);
      setDraftBody(current);
      setEditing(true);
    }
    setAiBusy(true);
    setEditError(null);
    const r = await onMutate({ action: "aiBody", title, body: current });
    setAiBusy(false);
    if (r.ok && typeof r.body === "string" && r.body.trim()) {
      setDraftBody(r.body.trim());
    } else {
      setEditError(r.error ?? "A IA não conseguiu gerar agora.");
    }
  }

  // --- comments (issues + PRs) ---
  const canComment = item.type !== "draft" && !!item.contentId;
  const [comments, setComments] = useState<ItemComment[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  // --- labels (issues + PRs, repo derived from the item URL) ---
  const repo = repoOf(item.url);
  const canLabel = item.type !== "draft" && !!item.contentId && !!repo;
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [repoLabels, setRepoLabels] = useState<RepoLabel[] | null>(null);
  const [labelBusy, setLabelBusy] = useState<string | null>(null);
  // mkt/dev/op quick tags — resolved (create-if-missing) repo label ids, cached.
  const [catIds, setCatIds] = useState<Record<string, string>>({});
  const [catBusy, setCatBusy] = useState<string | null>(null);
  // Fire priority (1🔥..5🔥) — portal-owned points.
  const [prioBusy, setPrioBusy] = useState(false);

  const dialogPanelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(dialogPanelRef, onClose);

  // Comments load once per dialog open.
  useEffect(() => {
    if (!canComment) return;
    let cancelled = false;
    onMutate({ action: "getComments", contentId: item.contentId }).then((r) => {
      if (cancelled) return;
      if (r.ok && r.comments) setComments(r.comments);
      else setCommentsError(r.error ?? "Não foi possível carregar os comentários");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.contentId]);

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

  // The task OWNER (ultimate responsible) — one of the assignees. Toggling the
  // current owner clears it. Portal-owned, so it works on any card.
  const [ownerBusy, setOwnerBusy] = useState(false);
  async function setOwner(login: string) {
    if (ownerBusy) return;
    const next = item.owner?.toLowerCase() === login.toLowerCase() ? null : login.toLowerCase();
    setOwnerBusy(true);
    try {
      const r = await onMutate({ action: "setOwner", itemId: item.id, owner: next });
      if (r.ok) onPatchItem(item.id, { owner: next ?? undefined });
    } finally {
      setOwnerBusy(false);
    }
  }

  // Reviewers (like git reviewers) — portal-owned list, independent of the
  // assignee set, works on any card type. Toggling a current reviewer removes it.
  const [reviewersBusy, setReviewersBusy] = useState(false);
  const [reviewersOpen, setReviewersOpen] = useState(false);
  const [reviewerManual, setReviewerManual] = useState("");
  async function setReviewers(next: string[]) {
    if (reviewersBusy) return;
    const desired = [...new Set(next.map((l) => l.toLowerCase()).filter(Boolean))];
    setReviewersBusy(true);
    try {
      const r = await onMutate({ action: "setReviewers", itemId: item.id, reviewers: desired });
      if (r.ok) onPatchItem(item.id, { reviewers: desired.length ? desired : undefined });
    } finally {
      setReviewersBusy(false);
    }
  }
  function toggleReviewer(login: string) {
    const cur = item.reviewers ?? [];
    const has = cur.some((l) => l.toLowerCase() === login.toLowerCase());
    return setReviewers(has ? cur.filter((l) => l.toLowerCase() !== login.toLowerCase()) : [...cur, login]);
  }
  function addManualReviewer() {
    const login = reviewerManual.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "");
    if (!login || reviewersBusy) return;
    if ((item.reviewers ?? []).some((l) => l.toLowerCase() === login.toLowerCase())) { setReviewerManual(""); return; }
    void setReviewers([...(item.reviewers ?? []), login]).then(() => setReviewerManual(""));
  }

  async function addManualAssignee() {
    const login = manualLogin.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "");
    if (!login || assignBusy) return;
    if (item.assignees.some((a) => a.login.toLowerCase() === login.toLowerCase())) { setManualLogin(""); return; }
    setAssignBusy(true);
    try {
      await onSetAssignees(item, [...item.assignees.map((a) => a.login), login]);
      setManualLogin("");
    } finally {
      setAssignBusy(false);
    }
  }

  async function saveEdit() {
    if (!item.contentId || saving) return;
    const title = draftTitle.trim();
    if (!title) return;
    setSaving(true);
    setEditError(null);
    const r = await onMutate({
      action: "updateContent",
      contentId: item.contentId,
      itemType: item.type,
      newTitle: title,
      newBody: draftBody,
    });
    setSaving(false);
    if (r.ok) {
      onPatchItem(item.id, { title, body: draftBody });
      setEditing(false);
    } else {
      setEditError(r.error ?? "Falha ao salvar");
    }
  }

  async function sendComment() {
    const text = commentDraft.trim();
    if (!text || !item.contentId || commentBusy) return;
    setCommentBusy(true);
    const r = await onMutate({ action: "addComment", contentId: item.contentId, newBody: text });
    if (r.ok) {
      setCommentDraft("");
      const refreshed = await onMutate({ action: "getComments", contentId: item.contentId });
      if (refreshed.ok && refreshed.comments) setComments(refreshed.comments);
    } else {
      setCommentsError(r.error ?? "Falha ao comentar");
    }
    setCommentBusy(false);
  }

  async function openLabels() {
    setLabelsOpen((v) => !v);
    if (repoLabels || !repo) return;
    const r = await onMutate({ action: "repoMeta", repo });
    if (r.ok && r.labels) setRepoLabels(r.labels);
  }

  async function toggleLabel(label: RepoLabel) {
    if (!item.contentId || labelBusy) return;
    const has = item.labels.some((l) => l.id === label.id);
    setLabelBusy(label.id);
    const r = await onMutate({
      action: "setLabels",
      contentId: item.contentId,
      addLabelIds: has ? [] : [label.id],
      removeLabelIds: has ? [label.id] : [],
    });
    if (r.ok) {
      onPatchItem(item.id, {
        labels: has
          ? item.labels.filter((l) => l.id !== label.id)
          : [...item.labels, { id: label.id, name: label.name, color: label.color }],
      });
    }
    setLabelBusy(null);
  }

  // Toggle a category tag (mkt/dev/op). Active state derives from the card's
  // labels by name; adding needs the repo label id, which we resolve once via
  // ensureLabels (creating the label in the repo if it doesn't exist yet).
  async function toggleCategory(spec: LabelSpec) {
    if (!item.contentId || !repo || catBusy) return;
    const existing = item.labels.find((l) => l.name.toLowerCase() === spec.name.toLowerCase());
    setCatBusy(spec.name);
    try {
      if (existing?.id) {
        const r = await onMutate({ action: "setLabels", contentId: item.contentId, removeLabelIds: [existing.id], addLabelIds: [] });
        if (r.ok) onPatchItem(item.id, { labels: item.labels.filter((l) => l.id !== existing.id) });
        return;
      }
      let id: string | undefined = catIds[spec.name.toLowerCase()];
      let color = spec.color;
      if (!id) {
        const meta = await onMutate({ action: "ensureLabels", repo, wanted: CATEGORY_LABELS });
        if (!meta.ok || !meta.labels) return;
        const map: Record<string, string> = {};
        for (const l of meta.labels) map[l.name.toLowerCase()] = l.id;
        setCatIds(map);
        const found = meta.labels.find((l) => l.name.toLowerCase() === spec.name.toLowerCase());
        id = found?.id;
        color = found?.color ?? color;
      }
      if (!id) return;
      const r = await onMutate({ action: "setLabels", contentId: item.contentId, addLabelIds: [id], removeLabelIds: [] });
      if (r.ok) onPatchItem(item.id, { labels: [...item.labels, { id, name: spec.name, color }] });
    } finally {
      setCatBusy(null);
    }
  }

  // Set fire priority (1..5). Clicking the current level clears it.
  async function setFirePriority(p: number) {
    if (prioBusy) return;
    const next = item.firePriority === p ? 0 : p;
    setPrioBusy(true);
    try {
      const r = await onMutate({ action: "setPriority", itemId: item.id, priority: next });
      if (r.ok) onPatchItem(item.id, { firePriority: next || undefined });
    } finally {
      setPrioBusy(false);
    }
  }

  async function setDeadline(value: string | null) {
    if (prioBusy) return;
    setPrioBusy(true);
    try {
      const r = await onMutate({ action: "setDeadline", itemId: item.id, deadline: value || null });
      if (r.ok) onPatchItem(item.id, { deadline: value || undefined });
    } finally {
      setPrioBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogPanelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="flex h-[90vh] w-full max-w-[95vw] flex-col rounded-2xl border border-border bg-surface-elevated shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <TypeIcon type={item.type} />
              {item.number != null && (
                <span className="font-mono tabular-nums text-xs text-foreground-subtle">#{item.number}</span>
              )}
              <StateBadge item={item} />
            </div>
            {editing ? (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-lg font-semibold text-foreground focus:border-border-strong focus:outline-none"
                autoFocus
              />
            ) : (
              <h3 className="text-lg font-semibold leading-snug text-foreground">{item.title}</h3>
            )}
            <div className="relative flex flex-wrap items-center gap-1">
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
              {canLabel && (
                <button
                  type="button"
                  onClick={openLabels}
                  aria-expanded={labelsOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-foreground-subtle transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <Tag className="h-2.5 w-2.5" /> Labels
                </button>
              )}
              {labelsOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLabelsOpen(false)} />
                  <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-64 overflow-y-auto rounded-xl border border-border bg-surface-elevated py-1 shadow-xl">
                    {!repoLabels ? (
                      <p className="flex items-center gap-2 px-3 py-2 text-xs text-foreground-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando labels…
                      </p>
                    ) : (
                      repoLabels.map((l) => {
                        const checked = item.labels.some((x) => x.id === l.id);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            disabled={labelBusy === l.id}
                            onClick={() => toggleLabel(l)}
                            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
                          >
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${l.color}` }} />
                            <span className="min-w-0 flex-1 truncate">{l.name}</span>
                            {labelBusy === l.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : checked ? (
                              <span className="text-accent">✓</span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
            {canLabel && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-foreground-faint">Categoria</span>
                {CATEGORY_LABELS.map((spec) => {
                  const on = item.labels.some((l) => l.name.toLowerCase() === spec.name.toLowerCase());
                  return (
                    <button
                      key={spec.name}
                      type="button"
                      onClick={() => toggleCategory(spec)}
                      disabled={catBusy === spec.name}
                      aria-pressed={on}
                      title={spec.description}
                      style={on ? { backgroundColor: `#${spec.color}`, borderColor: `#${spec.color}` } : undefined}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase transition-colors disabled:opacity-50 ${
                        on ? "border-transparent text-white" : "border-border text-foreground-subtle hover:border-border-strong hover:text-foreground"
                      }`}
                    >
                      {catBusy === spec.name ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : !on ? (
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${spec.color}` }} aria-hidden />
                      ) : null}
                      {spec.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-foreground-faint">Prioridade</span>
              {[1, 2, 3, 4, 5].map((p) => {
                const on = (item.firePriority ?? 0) >= p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFirePriority(p)}
                    disabled={prioBusy}
                    aria-label={`Definir prioridade ${p} de 5`}
                    title={item.firePriority === p ? `Prioridade ${p}/5 (clique pra limpar)` : `Prioridade ${p}/5`}
                    className={`text-sm leading-none transition-all disabled:opacity-50 ${on ? "grayscale-0" : "opacity-30 grayscale hover:opacity-60"}`}
                  >
                    🔥
                  </button>
                );
              })}
              {item.firePriority ? (
                <span className="ml-0.5 text-[10px] tabular-nums text-foreground-subtle">{item.firePriority}/5</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-foreground-faint">Deadline</span>
              <input
                type="date"
                value={item.deadline ?? ""}
                disabled={prioBusy}
                onChange={(e) => setDeadline(e.target.value || null)}
                className="rounded-lg border border-border bg-surface px-2 py-0.5 text-xs text-foreground outline-none focus:border-border-strong disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]"
              />
              {item.deadline ? (
                <button
                  type="button"
                  onClick={() => setDeadline(null)}
                  disabled={prioBusy}
                  className="text-[10px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                >
                  limpar
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!editing && (
              <button
                type="button"
                onClick={copyCardLink}
                aria-label="Copiar link do card"
                title={linkCopied ? "Link copiado!" : "Copiar link do card"}
                className={`rounded-lg border p-2 transition-colors ${
                  linkCopied
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"
                }`}
              >
                {linkCopied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              </button>
            )}
            {item.contentId && !editing && (
              <button
                type="button"
                onClick={aiAssist}
                disabled={aiBusy}
                aria-label={item.body?.trim() ? "Melhorar descrição com IA" : "Gerar descrição com IA"}
                title={item.body?.trim() ? "Melhorar descrição com IA" : "Gerar descrição com IA"}
                className="rounded-lg border border-accent-border bg-accent-bg p-2 text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </button>
            )}
            {item.contentId && !editing && (
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(item.title);
                  setDraftBody(item.body ?? "");
                  setEditing(true);
                }}
                aria-label="Editar card"
                className="rounded-lg border border-border p-2 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg border border-border p-2 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {editing ? (
            <div className="flex h-full flex-col gap-3">
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Descrição (markdown do GitHub)…"
                className="min-h-0 w-full flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
              />
              {editError && <p className="text-xs text-danger">{editError}</p>}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={aiAssist}
                  disabled={aiBusy || !draftTitle.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                >
                  {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {draftBody.trim() ? "Melhorar com IA" : "Gerar com IA"}
                </button>
                <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving || !draftTitle.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Salvar alterações
                </button>
                </div>
              </div>
            </div>
          ) : item.body?.trim() ? (
            <MarkdownContent markdown={item.body} githubRepo={repoOf(item.url)} />
          ) : (
            <p className="text-sm italic text-foreground-faint">Sem descrição.</p>
          )}

          {/* Reopen a closed issue/PR */}
          {!editing && item.type !== "draft" && item.state === "closed" && item.contentId && (
            <div className="mt-6 border-t border-border pt-4">
              <button
                type="button"
                onClick={reopenCard}
                disabled={reopening}
                className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold text-success transition hover:bg-success/20 disabled:opacity-50"
              >
                {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDot className="h-4 w-4" />}
                Reabrir {item.type === "pr" ? "PR" : "issue"}
              </button>
            </div>
          )}

          {/* Draft → issue, and solve-with-agent (issues) → PR for review. */}
          {!editing && issueRepo && (item.type === "draft" || item.type === "issue") && (
            <div className="mt-6 space-y-2 border-t border-border pt-4">
              {actionError && <p className="text-xs text-danger">{actionError}</p>}
              {item.type === "draft" && (
                <button
                  type="button"
                  onClick={convertToIssue}
                  disabled={converting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
                >
                  {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDot className="h-4 w-4" />}
                  Converter em issue
                </button>
              )}
              {item.type === "issue" && !solveRes && !solveBusy && (
                <button
                  type="button"
                  onClick={solveWithAgent}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20"
                >
                  <GitPullRequest className="h-4 w-4" /> Resolver com agente → PR
                </button>
              )}
              {item.type === "issue" && solveBusy && <AgentSolveProgress />}
              {solveRes && (
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
                  {solveRes.prUrl ? (
                    <a href={solveRes.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-success hover:underline">
                      <GitPullRequest className="h-4 w-4" /> PR pronto pra revisão ↗
                    </a>
                  ) : (
                    <>
                      <p className="mb-1 font-semibold text-warning">O agente terminou sem URL de PR:</p>
                      <MarkdownContent markdown={solveRes.result} githubRepo={issueRepo} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bounty + EXEC meeting — feature parity with the SOPA aggregated board.
              Collapsed they sit side by side; an open/expanded bounty panel is
              w-full and wraps to its own row. */}
          {!editing && projectSlug && (
            <div className="mt-6 flex flex-wrap items-start gap-2 border-t border-border pt-4">
              {(bounty || canManage) && (
                <BountyPanel
                  projectSlug={projectSlug}
                  taskKey={taskKeyOf(item)}
                  title={item.title}
                  bounty={bounty}
                  canManage={canManage}
                  onChanged={onBountyChanged}
                />
              )}
              <ExecMeetingButton projectSlug={projectSlug} title={item.title} body={item.body} logins={item.assignees.map((a) => a.login)} />
            </div>
          )}

          {/* Comments + Test/QA side by side (the XXL dialog gives room for two columns) */}
          {!editing && (
            <div className="mt-6 grid grid-cols-1 gap-6 border-t border-border pt-4 lg:grid-cols-2">
              {/* Comments column — GitHub thread on real cards, portal notes on drafts */}
              <div className="min-w-0">
                {canComment ? (
                  <>
                    <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Comentários{comments ? ` (${comments.length})` : ""}
                    </p>
                    {commentsError ? (
                      <p className="text-xs text-danger">{commentsError}</p>
                    ) : !comments ? (
                      <p className="flex items-center gap-2 text-xs text-foreground-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
                      </p>
                    ) : comments.length === 0 ? (
                      <p className="text-xs italic text-foreground-faint">Nenhum comentário ainda.</p>
                    ) : (
                      <div className="space-y-3">
                        {comments.map((c) => (
                          <div key={c.id} className="flex gap-2.5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.avatarUrl} alt={c.author} width={24} height={24}
                              className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover" />
                            <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2">
                              <p className="mb-1 text-[11px] text-foreground-subtle">
                                <span className="font-semibold text-foreground-muted">@{c.author}</span>{" "}
                                · {new Date(c.createdAt).toLocaleString()}
                              </p>
                              <div className="text-[13px]">
                                <CollapsibleMarkdown markdown={c.body} githubRepo={repoOf(item.url)} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Composer */}
                    <div className="mt-3 flex items-end gap-2">
                      <textarea
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            void sendComment();
                          }
                        }}
                        rows={2}
                        placeholder="Escreva um comentário… (⌘+Enter envia)"
                        className="min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={sendComment}
                        disabled={commentBusy || !commentDraft.trim()}
                        aria-label="Send comment"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50"
                      >
                        {commentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </>
                ) : projectSlug ? (
                  <CardNotes projectSlug={projectSlug} cardKey={item.id} label="Comentários" />
                ) : null}
              </div>

              {/* Test / QA column */}
              <div className="min-w-0">
                <CardTestSection
                  item={item}
                  repo={repoOf(item.url) ?? issueRepo ?? null}
                  team={team}
                  statusCtx={statusCtx}
                  onPatchItem={onPatchItem}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="relative flex min-w-0 items-center gap-2">
            {item.assignees.length > 0 ? (
              <>
                <div className="flex -space-x-1.5">
                  {item.assignees.map((a) => {
                    const member = memberForLogin(a.login);
                    const avatar = (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={a.avatarUrl} alt={a.login} title={member ? `Open @${member.username} contact card` : a.login} width={24} height={24}
                        className="h-6 w-6 rounded-full object-cover ring-2 ring-surface-elevated" />
                    );
                    return member ? (
                      <button
                        key={a.login}
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent("kanban:open-member", { detail: { username: member.username } }))}
                        className="rounded-full transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent"
                        aria-label={`Open @${member.username} contact card`}
                      >
                        {avatar}
                      </button>
                    ) : (
                      <span key={a.login}>{avatar}</span>
                    );
                  })}
                </div>
                <span className="truncate text-xs text-foreground-subtle">
                  {item.assignees.map((a) => {
                    const member = memberForLogin(a.login);
                    return member ? `@${member.username}` : `@${a.login}`;
                  }).join(", ")}
                </span>
              </>
            ) : (
              <span className="text-xs text-foreground-faint">Sem responsável</span>
            )}
            {canAssign && (
              <button
                type="button"
                onClick={() => setAssignOpen((v) => !v)}
                aria-expanded={assignOpen}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                Atribuir
              </button>
            )}
            {assignOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAssignOpen(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-60 overflow-y-auto rounded-xl border border-border bg-surface-elevated py-1 shadow-xl">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-foreground-faint">
                    Colaboradores com acesso
                  </p>
                  {team.map((m) => {
                    const checked = item.assignees.some(
                      (a) => a.login.toLowerCase() === m.login.toLowerCase(),
                    );
                    const isOwner = item.owner?.toLowerCase() === m.login.toLowerCase();
                    return (
                      <div
                        key={m.login}
                        className="flex w-full items-center gap-1 px-1.5 text-sm text-foreground-muted"
                      >
                        <button
                          type="button"
                          disabled={assignBusy}
                          onClick={() => toggleAssignee(m.login)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.avatarUrl}
                            alt={m.login}
                            width={22}
                            height={22}
                            className="h-[22px] w-[22px] rounded-full object-cover"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-foreground">@{m.login}</span>
                            {m.username && (
                              <span className="block truncate text-[11px] text-foreground-subtle">{m.username}</span>
                            )}
                          </span>
                          {checked && <span className="text-accent">✓</span>}
                        </button>
                        {/* Crown = owner. Only meaningful once assigned. */}
                        {checked && (
                          <button
                            type="button"
                            disabled={ownerBusy}
                            onClick={() => setOwner(m.login)}
                            title={isOwner ? "Dono — clique pra remover" : "Definir como dono"}
                            aria-pressed={isOwner}
                            className={`shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-50 ${isOwner ? "text-accent" : "text-foreground-faint hover:text-foreground"}`}
                          >
                            <Crown className={`h-3.5 w-3.5 ${isOwner ? "fill-accent" : ""}`} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {team.length === 0 && (
                    <p className="px-3 py-1.5 text-[11px] text-foreground-faint">Lista de colaboradores indisponível — atribua por @login abaixo.</p>
                  )}
                  {/* Manual assign: any GitHub login (org member / repo access) */}
                  <div className="border-t border-border px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={manualLogin}
                        onChange={(e) => setManualLogin(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addManualAssignee(); } }}
                        placeholder="@login do GitHub"
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
                      />
                      <button type="button" disabled={assignBusy || !manualLogin.trim()} onClick={() => void addManualAssignee()} className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50">
                        {assignBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Adicionar"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-foreground-faint">Atribui qualquer usuário com acesso ao repo (ou da org).</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Reviewers (like git reviewers) — portal-owned, works on any card type */}
          <div className="relative flex min-w-0 items-center gap-2 border-l border-border pl-4">
            <Eye className="h-3.5 w-3.5 shrink-0 text-foreground-faint" aria-hidden="true" />
            {(item.reviewers ?? []).length > 0 ? (
              <>
                <div className="flex -space-x-1.5">
                  {(item.reviewers ?? []).map((login) => {
                    const m = memberForLogin(login);
                    return (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={login}
                        src={`https://github.com/${encodeURIComponent(login)}.png?size=48`}
                        alt={login}
                        title={m ? `Revisor · @${m.username}` : `Revisor · @${login}`}
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-full object-cover ring-2 ring-surface-elevated"
                      />
                    );
                  })}
                </div>
                <span className="truncate text-xs text-foreground-subtle">
                  {(item.reviewers ?? []).map((l) => `@${memberForLogin(l)?.username ?? l}`).join(", ")}
                </span>
              </>
            ) : (
              <span className="text-xs text-foreground-faint">Sem revisores</span>
            )}
            <button
              type="button"
              onClick={() => setReviewersOpen((v) => !v)}
              aria-expanded={reviewersOpen}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              Revisores
            </button>
            {reviewersOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setReviewersOpen(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-60 overflow-y-auto rounded-xl border border-border bg-surface-elevated py-1 shadow-xl">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-foreground-faint">
                    Solicitar revisão de
                  </p>
                  {team.map((m) => {
                    const checked = (item.reviewers ?? []).some((l) => l.toLowerCase() === m.login.toLowerCase());
                    return (
                      <button
                        key={m.login}
                        type="button"
                        disabled={reviewersBusy}
                        onClick={() => void toggleReviewer(m.login)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.avatarUrl} alt={m.login} width={22} height={22} className="h-[22px] w-[22px] rounded-full object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-foreground">@{m.login}</span>
                          {m.username && <span className="block truncate text-[11px] text-foreground-subtle">{m.username}</span>}
                        </span>
                        {checked && <span className="text-accent">✓</span>}
                      </button>
                    );
                  })}
                  {team.length === 0 && (
                    <p className="px-3 py-1.5 text-[11px] text-foreground-faint">Lista de colaboradores indisponível — adicione por @login abaixo.</p>
                  )}
                  <div className="border-t border-border px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={reviewerManual}
                        onChange={(e) => setReviewerManual(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualReviewer(); } }}
                        placeholder="@login do GitHub"
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
                      />
                      <button type="button" disabled={reviewersBusy || !reviewerManual.trim()} onClick={addManualReviewer} className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50">
                        {reviewersBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Adicionar"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-foreground-faint">Revisores são portal-owned — valem pra qualquer card (issue, PR ou draft).</p>
                  </div>
                </div>
              </>
            )}
          </div>
          </div>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              Abrir no GitHub
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

type ItemComment = { id: string; author: string; avatarUrl: string; body: string; createdAt: string };
type RepoLabel = { id: string; name: string; color: string };
export type MutateFn = (payload: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: string;
  itemId?: string;
  /** Content node id of a freshly created card (draft/issue) — enables editing it immediately. */
  contentId?: string | null;
  url?: string;
  number?: number;
  comments?: ItemComment[];
  repoId?: string;
  labels?: RepoLabel[];
  /** aiBody — generated/improved card body markdown. */
  body?: string;
}>;

type Board = Extract<KanbanResult, { ok: true }> & {
  /** Everyone assignable on the board's repos (GitHub collaborators), with the
   *  portal username attached when a team card maps the login. */
  assignable?: { login: string; avatarUrl: string; username: string | null }[];
  /** Team contact cards from the central roster, used by Kanban assignee clicks. */
  teamMembers?: TeamMember[];
  /** This board's project slug — for bounty / EXEC-meeting actions. */
  projectSlug?: string;
  /** Viewer is a global admin (may create/propose bounties). */
  canManage?: boolean;
  /** Bounties reserved on this project's tasks (open/proposed/paid). */
  bounties?: BountyDTO[];
};

export function KanbanBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<KanbanItem | null>(null);
  const [detailItem, setDetailItem] = useState<KanbanItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; level: "error" | "success" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const { confirm, confirmUI } = useConfirm();
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [personFilter, setPersonFilter] = useState<string[]>([]); // assignee logins (lowercase); empty = all
  const [showDone, setShowDone] = useState(false); // hide completed columns by default

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

  // Deep-link: /kanban?open=<itemId> opens that card once the board has loaded.
  // We keep the param (don't strip) so the open card stays shareable.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (!board || openedFromUrl.current) return;
    openedFromUrl.current = true;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    const item = board.columns.flatMap((c) => c.items).find((it) => it.id === id);
    if (item) setDetailItem(item);
  }, [board]);

  // Keep ?open=<id> in sync with the open card so any open card has a copyable,
  // shareable URL (and closing clears it). Guarded until the deep-link above ran
  // so the initial ?open isn't stripped before the board loads.
  useEffect(() => {
    if (!openedFromUrl.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (detailItem) params.set("open", detailItem.id);
    else params.delete("open");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [detailItem]);

  useEffect(() => {
    const onOpenMember = (event: Event) => {
      const username = (event as CustomEvent<{ username?: string }>).detail?.username?.toLowerCase();
      if (!username) return;
      setSelectedMember(board?.teamMembers?.find((m) => m.username.toLowerCase() === username) ?? null);
    };
    window.addEventListener("kanban:open-member", onOpenMember);
    return () => window.removeEventListener("kanban:open-member", onOpenMember);
  }, [board?.teamMembers]);

  function flash(msg: string, level: "error" | "success" = "error") {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ msg, level });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  // --- mutation helper ---
  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        itemId?: string;
        contentId?: string | null;
        url?: string;
        number?: number;
      };
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
          if (!r.ok) throw new Error(r.error || "Falha ao mudar o status");
        } else {
          // "No Status" column — clear the field.
          const r = await mutate({
            action: "clearStatus",
            projectId: nextBoard.projectId,
            fieldId: nextBoard.statusFieldId,
            itemId: activeId,
          });
          if (!r.ok) throw new Error(r.error || "Falha ao limpar o status");
        }
      }
      const rp = await mutate({
        action: "move",
        projectId: nextBoard.projectId,
        itemId: activeId,
        afterId,
      });
      if (!rp.ok) throw new Error(rp.error || "Falha ao reordenar");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Falha ao atualizar — revertendo");
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Primary repo = the one most cards point at; powers "new Issue" + labels.
  const primaryRepo = useMemo(() => {
    if (!board) return null;
    const counts = new Map<string, number>();
    for (const c of board.columns) {
      for (const i of c.items) {
        const r = repoOf(i.url);
        if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [board]);

  // --- card actions ---
  async function onAddDraft(columnName: string, title: string, kind: "draft" | "issue" = "draft") {
    if (!board) return;
    const col = board.columns.find((c) => c.name === columnName);
    setBusy(true);
    try {
      const r =
        kind === "issue" && primaryRepo
          ? await mutate({ action: "createIssue", projectId: board.projectId, repo: primaryRepo, newTitle: title })
          : await mutate({ action: "addDraft", projectId: board.projectId, title });
      if (!r.ok || !r.itemId) throw new Error(r.error || "Falha ao adicionar card");
      if (board.statusFieldId && col?.optionId) {
        await mutate({
          action: "setStatus",
          projectId: board.projectId,
          fieldId: board.statusFieldId,
          itemId: r.itemId,
          optionId: col.optionId,
        });
      }
      // Optimistically drop the new card at the TOP of its column and open it so
      // the user can add a description right away. We deliberately DON'T refetch
      // here: GitHub's Projects API is eventually consistent, so an instant
      // reload often comes back WITHOUT the new card (it'd vanish) and otherwise
      // buries it at the bottom. The new card carries its contentId, so editing
      // works immediately; the next refresh reconciles ordering.
      const newItem: KanbanItem = {
        id: r.itemId,
        type: kind === "issue" ? "issue" : "draft",
        title,
        number: r.number,
        url: r.url,
        state: kind === "issue" ? "open" : undefined,
        contentId: r.contentId ?? null,
        assignees: [],
        labels: [],
      };
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              columns: prev.columns.map((c) =>
                c.name === columnName ? { ...c, items: [newItem, ...c.items] } : c,
              ),
            }
          : prev,
      );
      setDetailItem(newItem);
      flash("Card criado — adicione uma descrição.", "success");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Falha ao adicionar card");
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(itemId: string) {
    if (!board) return;
    setBusy(true);
    try {
      const r = await mutate({ action: "archive", projectId: board.projectId, itemId });
      if (!r.ok) throw new Error(r.error || "Falha ao arquivar");
      setBoard((prev) =>
        prev ? { ...prev, columns: prev.columns.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) })) } : prev,
      );
      flash("Card arquivado.", "success");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Falha ao arquivar");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(itemId: string) {
    if (!board) return;
    if (!(await confirm({
      title: "Deletar card?",
      message: "Isto remove o card permanentemente do projeto. Esta ação não pode ser desfeita.",
      confirmLabel: "Deletar",
    }))) return;
    setBusy(true);
    try {
      const r = await mutate({ action: "delete", projectId: board.projectId, itemId });
      if (!r.ok) throw new Error(r.error || "Falha ao deletar");
      setBoard((prev) =>
        prev ? { ...prev, columns: prev.columns.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) })) } : prev,
      );
      flash("Card deletado.", "success");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Falha ao deletar");
    } finally {
      setBusy(false);
    }
  }

  // Optimistically patch a card everywhere it lives (board columns + the
  // open detail dialog).
  const patchItem = useCallback((itemId: string, patch: Partial<KanbanItem>) => {
    setBoard((prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
            })),
          }
        : prev,
    );
    setDetailItem((prev) => (prev && prev.id === itemId ? { ...prev, ...patch } : prev));
  }, []);

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
      if (!r.ok) throw new Error(r.error || "Falha ao atualizar responsáveis");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Falha ao atualizar responsáveis");
      await load();
    }
  }

  // --- render ---
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2" aria-label="Carregando o Kanban">
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
    const message = error ?? "Falha ao carregar";
    const hint = /scope|permission|token/i.test(message);
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-6" role="alert">
        <p className="text-sm font-medium text-danger">Falha ao carregar o Kanban</p>
        <p className="mt-1 text-xs text-foreground-muted">{message}</p>
        {hint && (
          <p className="mt-3 text-xs text-foreground-subtle">
            Confirme que <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">GITHUB_TOKEN</code> tem os escopos{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">project</code>,{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">read:org</code> e{" "}
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">repo</code>.
          </p>
        )}
      </div>
    );
  }

  const { title, url, columns, truncated } = board;

  // People to filter by: assignable collaborators ∪ anyone already assigned.
  const people = (() => {
    const map = new Map<string, { login: string; avatarUrl: string }>();
    for (const m of board.assignable ?? []) map.set(m.login.toLowerCase(), { login: m.login, avatarUrl: m.avatarUrl });
    for (const c of columns) for (const it of c.items) for (const a of it.assignees) {
      if (!map.has(a.login.toLowerCase())) map.set(a.login.toLowerCase(), { login: a.login, avatarUrl: a.avatarUrl });
    }
    return [...map.values()].sort((a, b) => a.login.localeCompare(b.login));
  })();
  const togglePerson = (login: string) => {
    const k = login.toLowerCase();
    setPersonFilter((prev) => (prev.includes(k) ? prev.filter((p) => p !== k) : [...prev, k]));
  };
  // Filtered view (real board data stays intact for drag/drop, which is by id).
  const isDone = (name: string) => /done|conclu|complete|finaliz/i.test(name);
  const doneCount = columns.filter((c) => isDone(c.name)).reduce((n, c) => n + c.items.length, 0);
  const bountyByKey = new Map((board.bounties ?? []).map((b) => [b.taskKey, b]));
  const personMatched = personFilter.length === 0
    ? columns
    : columns.map((c) => ({ ...c, items: c.items.filter((it) => it.assignees.some((a) => personFilter.includes(a.login.toLowerCase()))) }));
  const displayColumns = personMatched.filter((c) => showDone || !isDone(c.name));
  const teamMemberByUsername = new Map((board.teamMembers ?? []).map((m) => [m.username.toLowerCase(), m]));
  const memberForLogin = (login: string): TeamMember | null => {
    const matched = board.assignable?.find((m) => m.login.toLowerCase() === login.toLowerCase());
    return matched?.username ? teamMemberByUsername.get(matched.username.toLowerCase()) ?? null : null;
  };
  const openMemberByLogin = (login: string): boolean => {
    const member = memberForLogin(login);
    if (!member) return false;
    setSelectedMember(member);
    return true;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Meta bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-foreground-subtle">
          {title}
          {truncated && <span className="text-xs text-warning">(first 100 items)</span>}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-faint" aria-label="Salvando" />}
        </p>
        <div className="flex items-center gap-2">
          {doneCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${showDone ? "border-accent bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}
            >
              {showDone ? "Ocultar concluídas" : "Mostrar concluídas"} <span className="text-foreground-faint">({doneCount})</span>
            </button>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir o projeto no GitHub"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            Abrir no GitHub
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Filter by person */}
      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPersonFilter([])}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${personFilter.length === 0 ? "border-accent bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}
          >
            Todos
          </button>
          {people.map((p) => {
            const on = personFilter.includes(p.login.toLowerCase());
            const member = memberForLogin(p.login);
            return (
              <button
                key={p.login}
                type="button"
                onClick={() => {
                  if (!openMemberByLogin(p.login)) togglePerson(p.login);
                }}
                title={member ? `Open @${member.username} contact card` : `Filter @${p.login}`}
                aria-pressed={on}
                className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] transition ${on ? "border-accent bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.avatarUrl} alt="" width={20} height={20} className="h-5 w-5 rounded-full object-cover" />
                {member ? member.username : p.login}
              </button>
            );
          })}
          {personFilter.length > 0 && (
            <span className="text-[10px] text-foreground-faint">
              {displayColumns.reduce((n, c) => n + c.items.length, 0)} cartões
            </span>
          )}
        </div>
      )}

      {toast && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            toast.level === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
          role={toast.level === "success" ? "status" : "alert"}
        >
          {toast.msg}
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
            {displayColumns.map((col) => (
              <ColumnView
                key={col.name}
                column={col}
                bountyByKey={bountyByKey}
                onArchive={onArchive}
                onDelete={onDelete}
                onAddDraft={onAddDraft}
                issueRepo={primaryRepo}
                onOpen={setDetailItem}
                memberForLogin={memberForLogin}
                onOpenMember={setSelectedMember}
                busy={busy}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeItem ? (
            <div className="w-72 rotate-2 rounded-xl border border-accent-border bg-surface-elevated p-3 shadow-2xl">
              <CardBody item={activeItem} bounty={bountyByKey.get(taskKeyOf(activeItem))} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {detailItem && (
        <CardDetailDialog
          item={detailItem}
          team={board.assignable ?? []}
          memberForLogin={memberForLogin}
          projectSlug={board.projectSlug}
          canManage={!!board.canManage}
          bounty={bountyByKey.get(taskKeyOf(detailItem))}
          onBountyChanged={load}
          issueRepo={primaryRepo}
          statusCtx={{
            projectId: board.projectId,
            fieldId: board.statusFieldId,
            columns: board.columns.map((c) => ({ name: c.name, optionId: c.optionId })),
          }}
          onSetAssignees={onSetAssignees}
          onMutate={(payload) => mutate({ ...payload, projectId: board.projectId })}
          onPatchItem={patchItem}
          onClose={() => setDetailItem(null)}
        />
      )}
      {selectedMember && (
        <MemberModal member={selectedMember} onClose={() => setSelectedMember(null)} />
      )}
      {confirmUI}
    </div>
  );
}
