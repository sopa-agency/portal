"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Maximize2, Minus, Plus, Crosshair } from "lucide-react";
import { useT } from "@/components/locale-provider";

/* ─────────────────────────────────────────────────────────────────────────────
   Infinite-canvas org chart — a spatial view instead of a page-flow tree.
   The chart is laid out ONCE into absolute coordinates (tidy top-down tree),
   then the whole plane is pan/zoomed with a single CSS transform. That keeps
   interaction at 60fps (no reflow per frame) and lets connectors be real SVG
   curves rather than CSS pseudo-element borders.
   ────────────────────────────────────────────────────────────────────────── */

export const NODE_W = 264;
export const NODE_H = 124;
const GAP_X = 28;
const GAP_Y = 78;
const PAD = 64; // world padding around the layout bounds
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
/** How long the tree takes to settle into a new shape. */
const MOVE_MS = 340;
/** Folding away is quicker than unfolding: leaving shouldn't cost attention. */
const EXIT_MS = 190;

type Point = { x: number; y: number };

const edgeKey = (from: string, to: string) => `${from}\u2192${to}`;
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const lerp = (a: Point, b: Point, e: number) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });

export type TreeLike = { id: string; children: TreeLike[] };

export type Placed<T> = {
  id: string;
  node: T;
  /** top-left of the card, in world coordinates */
  x: number;
  y: number;
  depth: number;
  /** Position among its siblings — the reveal fans out left to right. */
  siblingIndex: number;
  hasChildren: boolean;
  collapsed: boolean;
};

export type Edge = { from: string; to: string };

export type Layout<T> = {
  placed: Placed<T>[];
  edges: Edge[];
  byId: Map<string, Placed<T>>;
  width: number;
  height: number;
};

/**
 * Tidy top-down tree layout. Leaves are packed left→right on a moving cursor;
 * a parent centers on its first/last child. Because a parent's centre always
 * falls inside its own subtree extent, and extents never overlap (the cursor
 * only moves forward), sibling subtrees can't collide.
 */
export function layoutTree<T extends TreeLike>(roots: T[], collapsed: Set<string>): Layout<T> {
  const placed: Placed<T>[] = [];
  const edges: Edge[] = [];
  let cursor = PAD;

  function walk(node: T, depth: number, siblingIndex: number): number {
    const isCollapsed = collapsed.has(node.id);
    const kids = (isCollapsed ? [] : node.children) as T[];
    let cx: number;
    if (kids.length === 0) {
      cx = cursor + NODE_W / 2;
      cursor += NODE_W + GAP_X;
    } else {
      const centres = kids.map((k, i) => walk(k, depth + 1, i));
      cx = (centres[0] + centres[centres.length - 1]) / 2;
      for (const k of kids) edges.push({ from: node.id, to: k.id });
    }
    placed.push({
      id: node.id,
      node,
      x: cx - NODE_W / 2,
      y: PAD + depth * (NODE_H + GAP_Y),
      depth,
      siblingIndex,
      hasChildren: node.children.length > 0,
      collapsed: isCollapsed,
    });
    return cx;
  }

  roots.forEach((r, i) => walk(r, 0, i));

  const maxX = placed.reduce((m, p) => Math.max(m, p.x + NODE_W), 0);
  const maxY = placed.reduce((m, p) => Math.max(m, p.y + NODE_H), 0);
  return {
    placed,
    edges,
    byId: new Map(placed.map((p) => [p.id, p])),
    width: maxX + PAD,
    height: maxY + PAD,
  };
}

/** Anchor points a connector runs between (bottom-centre → top-centre). */
const outAnchor = (p: Point) => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H });
const inAnchor = (p: Point) => ({ x: p.x + NODE_W / 2, y: p.y });

function edgePath(a: Point, b: Point) {
  const dy = Math.max(24, (b.y - a.y) * 0.55);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
}

type Transform = { x: number; y: number; k: number };

export function OrgCanvas<T extends TreeLike>({
  layout,
  renderNode,
  activeEdgeIds,
  dimmedIds,
  emptyHint,
  toolbarExtra,
}: {
  layout: Layout<T>;
  renderNode: (p: Placed<T>) => ReactNode;
  /** ids whose incoming edge should be drawn highlighted (root→selected path). */
  activeEdgeIds?: Set<string>;
  /** ids to fade out (search miss). */
  dimmedIds?: Set<string>;
  emptyHint?: ReactNode;
  toolbarExtra?: ReactNode;
}) {
  const t9n = useT().orgChart.canvas;
  const hostRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  // Pointer handlers need the CURRENT transform without re-subscribing on every
  // pan frame, so it's mirrored into a ref (written after paint, never in render).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const fittedFor = useRef<string>("");

  const clampK = (k: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));

  // A transform the USER didn't drag — a fit, a zoom button, the re-fit after a
  // branch folds — eases instead of teleporting. A gesture must never ease: a
  // transition on the plane would rubber-band under the pointer.
  const [smooth, setSmooth] = useState(false);
  const smoothTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glide = useCallback(() => {
    setSmooth(true);
    if (smoothTimer.current) clearTimeout(smoothTimer.current);
    smoothTimer.current = setTimeout(() => setSmooth(false), MOVE_MS + 60);
  }, []);
  const cutGlide = useCallback(() => {
    if (smoothTimer.current) {
      clearTimeout(smoothTimer.current);
      smoothTimer.current = null;
    }
    setSmooth(false);
  }, []);
  useEffect(() => () => {
    if (smoothTimer.current) clearTimeout(smoothTimer.current);
  }, []);

  const fit = useCallback(() => {
    const el = hostRef.current;
    if (!el || !layout.width || !layout.height) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    if (!cw || !ch) return;
    const k = clampK(Math.min(cw / layout.width, ch / layout.height, 1));
    glide();
    setT({ k, x: (cw - layout.width * k) / 2, y: (ch - layout.height * k) / 2 });
  }, [layout.width, layout.height, glide]);

  // Fit once per distinct layout size (a node added/collapsed re-fits, panning
  // around does not snap back).
  useLayoutEffect(() => {
    const key = `${Math.round(layout.width)}x${Math.round(layout.height)}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  }, [fit, layout.width, layout.height]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Keep the chart in frame when the window/sidebar resizes.
      fittedFor.current = "";
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = hostRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setT((prev) => {
      const k = clampK(prev.k * factor);
      if (k === prev.k) return prev;
      const ratio = k / prev.k;
      return { k, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio };
    });
  }, []);

  const zoomCentre = useCallback(
    (factor: number) => {
      const el = hostRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      glide();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt, glide],
  );

  // Wheel: trackpad two-finger scroll pans, pinch (ctrl/⌘ + wheel) zooms — the
  // same contract design canvases use. Registered natively so preventDefault
  // works (React's onWheel is passive).
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cutGlide();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY / 220));
      } else {
        setT((prev) => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, cutGlide]);

  // Pointer pan + two-finger pinch. Dragging only starts on the canvas surface
  // itself, so buttons and cards keep their own click behaviour.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; k: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // Where the gesture started, and whether it has passed the slop threshold that
  // turns "a click that wobbled" into "a drag".
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // Form fields keep their own press-drag (caret, text selection).
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    swallowClick.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: tRef.current.k };
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = clampK(pinch.current.k * (dist / pinch.current.dist));
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / tRef.current.k);
      return;
    }

    const d = drag.current;
    if (d && d.id === e.pointerId && !d.moved) {
      // Under the threshold this is still a click in progress — swallow the
      // movement rather than nudging the plane by a pixel.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      cutGlide();
      // Armed here, not on pointerup: browsers disagree on whether
      // lostpointercapture lands before or after pointerup, and a pan that ends
      // over a card must never also open it.
      swallowClick.current = true;
      // Capture only NOW. Capturing on pointerdown would retarget the
      // compatibility click to this host, and every card would stop opening.
      hostRef.current?.setPointerCapture(e.pointerId);
      setPanning(true);
    }
    setT((cur) => ({ ...cur, x: cur.x + (e.clientX - prev.x), y: cur.y + (e.clientY - prev.y) }));
  }

  function endPointer(e: React.PointerEvent) {
    if (drag.current?.id === e.pointerId) drag.current = null;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setPanning(false);
  }

  // Capture phase, so the card's own onClick never runs after a pan.
  function onClickCapture(e: React.MouseEvent) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  /* ── Reshaping the tree ───────────────────────────────────────────────────
     Folding a branch moves every card that was standing to its right. Letting
     React write the new coordinates would snap them there, and — worse — the
     connectors would snap while the cards eased, so the lines would detach
     from the cards they connect for the length of the transition.

     So positions are tweened in one rAF loop that writes cards AND paths from
     the same interpolated state, straight to the DOM. React owns what exists;
     this loop owns where it sits. ────────────────────────────────────────── */
  // Keyed by RENDER slot, not by node id: a card that is folding away and the
  // same card already unfolding again coexist for a few frames, and one's
  // unmount must not evict the other's element. What each slot points AT is
  // carried in the value.
  const nodeEls = useRef(new Map<string, { el: HTMLDivElement; id: string }>());
  const pathEls = useRef(new Map<string, { el: SVGPathElement; from: string; to: string }>());
  const posRef = useRef(new Map<string, Point>());
  const prevLayout = useRef<Layout<T> | null>(null);
  const raf = useRef(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cards on their way out: React can't unmount them until they've faded, so
  // they outlive the layout that dropped them.
  const [leaving, setLeaving] = useState<{ nodes: Placed<T>[]; edges: Edge[] }>({ nodes: [], edges: [] });

  const paint = useCallback((pos: Map<string, Point>) => {
    for (const { el, id } of nodeEls.current.values()) {
      const p = pos.get(id);
      if (p) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    }
    for (const { el, from, to } of pathEls.current.values()) {
      const a = pos.get(from);
      const b = pos.get(to);
      if (a && b) el.setAttribute("d", edgePath(outAnchor(a), inAnchor(b)));
    }
  }, []);

  useLayoutEffect(() => {
    const prev = prevLayout.current;
    prevLayout.current = layout;
    const next = new Map<string, Point>(layout.placed.map((p) => [p.id, { x: p.x, y: p.y }]));

    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // First commit, or motion turned off: land on the answer.
    if (!prev || reduced) {
      posRef.current = next;
      paint(next);
      return;
    }

    const was = posRef.current;
    const prevParent = new Map(prev.edges.map((e) => [e.to, e.from]));
    const nextParent = new Map(layout.edges.map((e) => [e.to, e.from]));
    const gone = prev.placed.filter((p) => !layout.byId.has(p.id));

    const from = new Map<string, Point>();
    const to = new Map<string, Point>();

    for (const p of layout.placed) {
      const end = { x: p.x, y: p.y };
      to.set(p.id, end);
      const before = was.get(p.id);
      if (before) {
        from.set(p.id, before);
        continue;
      }
      // Arriving: unfold OUT of wherever its parent was standing, so a branch
      // reads as opening from its own root rather than materialising.
      const parent = nextParent.get(p.id);
      const anchor = parent ? was.get(parent) ?? next.get(parent) : undefined;
      from.set(p.id, anchor ?? end);
    }
    for (const g of gone) {
      const start = was.get(g.id) ?? { x: g.x, y: g.y };
      from.set(g.id, start);
      // Departing: pulled back into the parent that swallowed it.
      const parent = prevParent.get(g.id);
      const anchor = parent ? next.get(parent) ?? was.get(parent) : undefined;
      to.set(g.id, anchor ?? start);
    }

    if (gone.length > 0) {
      const goneIds = new Set(gone.map((g) => g.id));
      setLeaving({ nodes: gone, edges: prev.edges.filter((e) => goneIds.has(e.to)) });
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => setLeaving({ nodes: [], edges: [] }), EXIT_MS);
    }

    cancelAnimationFrame(raf.current);
    // Paint frame zero synchronously. Arriving cards have no transform of their
    // own yet, so if the first rAF ever landed after a paint they'd flash at the
    // plane's origin — this makes that impossible rather than unlikely.
    posRef.current = from;
    paint(from);

    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / MOVE_MS);
      const e = easeOut(u);
      const cur = new Map<string, Point>();
      for (const [id, a] of from) cur.set(id, lerp(a, to.get(id) ?? a, e));
      posRef.current = cur;
      paint(cur);
      if (u < 1) raf.current = requestAnimationFrame(step);
      else posRef.current = next;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [layout, paint]);

  // The cards that just mounted for the exit animation need placing on their
  // very first frame, or they'd flash at the plane's origin. posRef still holds
  // the outgoing positions here — the tween's first frame hasn't run yet.
  useLayoutEffect(() => {
    if (leaving.nodes.length > 0) paint(posRef.current);
  }, [leaving, paint]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const nodeRef = useCallback(
    (slot: string, id: string) => (el: HTMLDivElement | null) => {
      if (el) nodeEls.current.set(slot, { el, id });
      else nodeEls.current.delete(slot);
    },
    [],
  );
  const pathRef = useCallback(
    (slot: string, from: string, to: string) => (el: SVGPathElement | null) => {
      if (el) pathEls.current.set(slot, { el, from, to });
      else pathEls.current.delete(slot);
    },
    [],
  );

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
      onClickCapture={onClickCapture}
      data-panning={panning ? "true" : undefined}
      className="org-canvas relative min-h-0 flex-1 cursor-grab overflow-hidden rounded-2xl border border-border bg-background"
      style={{
        backgroundImage: "radial-gradient(circle at center, var(--canvas-dot) 1px, transparent 1px)",
        backgroundSize: `${28 * t.k}px ${28 * t.k}px`,
        backgroundPosition: `${t.x}px ${t.y}px`,
        // The grid is painted on the host, not the plane, so it needs the same
        // easing or the texture slides out of step with the cards.
        transition: smooth
          ? `background-position ${MOVE_MS}ms cubic-bezier(0.32, 1.02, 0.35, 1), background-size ${MOVE_MS}ms cubic-bezier(0.32, 1.02, 0.35, 1)`
          : undefined,
        touchAction: "none",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.k})`,
          transition: smooth ? `transform ${MOVE_MS}ms cubic-bezier(0.32, 1.02, 0.35, 1)` : undefined,
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          aria-hidden
        >
          {/* `d` is never written from JSX — the tween owns it (see paint). */}
          {layout.edges.map((e) => (
            <path
              key={edgeKey(e.from, e.to)}
              ref={pathRef(`live-${edgeKey(e.from, e.to)}`, e.from, e.to)}
              fill="none"
              strokeWidth={activeEdgeIds?.has(e.to) ? 2 : 1.25}
              className={`org-edge-in transition-[stroke-width] ${
                activeEdgeIds?.has(e.to) ? "stroke-accent" : "stroke-border-strong"
              }`}
              strokeLinecap="round"
            />
          ))}
          {leaving.edges.map((e) => (
            <path
              key={`leaving-${edgeKey(e.from, e.to)}`}
              ref={pathRef(`leaving-${edgeKey(e.from, e.to)}`, e.from, e.to)}
              fill="none"
              strokeWidth={1.25}
              className="org-edge-out stroke-border-strong"
              strokeLinecap="round"
            />
          ))}
        </svg>

        {layout.placed.map((p) => (
          <div
            key={p.id}
            ref={nodeRef(`live-${p.id}`, p.id)}
            className="absolute left-0 top-0"
            style={{ width: NODE_W }}
          >
            {/* Separate element: the entrance animates transform, and the
                wrapper's transform is the card's position on the plane. */}
            <div
              className="org-node-in"
              style={{
                // Siblings fan out left to right, levels cascade downward — the
                // branch reads as unfolding rather than blinking into place.
                animationDelay: `${Math.min(p.depth * 24 + p.siblingIndex * 30, 210)}ms`,
                opacity: dimmedIds?.has(p.id) ? 0.22 : undefined,
                transition: "opacity 200ms",
              }}
            >
              {renderNode(p)}
            </div>
          </div>
        ))}

        {leaving.nodes.map((placed) => (
          <div
            key={`leaving-${placed.id}`}
            ref={nodeRef(`leaving-${placed.id}`, placed.id)}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0"
            style={{ width: NODE_W }}
          >
            <div className="org-node-out">{renderNode(placed)}</div>
          </div>
        ))}
      </div>

      {layout.placed.length === 0 && emptyHint && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{emptyHint}</div>
      )}

      {/* Floating glass toolbar — chrome stays off the canvas itself. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface/80 p-1 shadow-lg backdrop-blur-md">
          {toolbarExtra}
          <button
            type="button"
            onClick={() => zoomCentre(1 / 1.2)}
            aria-label={t9n.zoomOut}
            title={t9n.zoomOut}
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface-elevated hover:text-foreground"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              glide();
              setT((prev) => ({ ...prev, k: 1 }));
            }}
            className="min-w-[3.25rem] rounded-full px-2 py-1 text-center font-mono text-[11px] font-semibold text-foreground-muted transition hover:bg-surface-elevated hover:text-foreground"
            title={t9n.resetZoom}
          >
            {Math.round(t.k * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomCentre(1.2)}
            aria-label={t9n.zoomIn}
            title={t9n.zoomIn}
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface-elevated hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            onClick={fit}
            aria-label={t9n.fit}
            title={t9n.fit}
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface-elevated hover:text-foreground"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const el = hostRef.current;
              const root = layout.placed.find((p) => p.depth === 0);
              if (!el || !root) return;
              glide();
              setT((prev) => ({
                ...prev,
                x: el.clientWidth / 2 - (root.x + NODE_W / 2) * prev.k,
                y: 96 - root.y * prev.k,
              }));
            }}
            aria-label={t9n.centerRoot}
            title={t9n.centerRoot}
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface-elevated hover:text-foreground"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
