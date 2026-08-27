"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   A macOS-dock toolbar: the control under the cursor swells, and its neighbours
   swell a little less, so a wave follows the pointer along the bar.

   Two deliberate departures from the navigation docks this pattern comes from:

   1. Slots don't move. In a dock the items push each other apart, which is
      charming for navigation and hostile for a TOOLBAR — buttons sliding away
      from the cursor you're aiming with. Each control here keeps a fixed slot
      and only grows visually, so what you aimed at is still where you aimed.
      It also makes the effect exact: the growth is anchored bottom-centre, so
      an item's horizontal centre never moves, and the distance the wave is
      computed from can't drift as the wave itself animates.

   2. No animation library. The springs run in one rAF loop writing transforms
      straight to the DOM, which is how the rest of this canvas already moves.
   ────────────────────────────────────────────────────────────────────────── */

/** Resting size of a square control. */
const BASE = 32;
/** How much the control directly under the cursor grows. */
const MAG = 1.45;
/** How far along the bar the wave reaches, in px. */
const RANGE = 96;
/** Spring: a touch of overshoot, so it settles rather than stops. */
const STIFFNESS = 0.26;
const DAMPING = 0.72;

export type DockButton = {
  key: string;
  /** Shown as the label above the control, and read out as its accessible name. */
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  /** For readouts that carry text instead of an icon (the zoom level). */
  text?: string;
  /** Slot width, when the control isn't square. */
  width?: number;
};

export type DockEntry = DockButton | { key: string; separator: true };

const isSeparator = (e: DockEntry): e is { key: string; separator: true } =>
  "separator" in e;

export function CanvasDock({ items, label }: { items: DockEntry[]; label: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLButtonElement>());
  const centres = useRef(new Map<string, number>());
  const springs = useRef(new Map<string, { k: number; v: number }>());
  const cursorX = useRef<number | null>(null);
  const raf = useRef(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const run = useCallback(() => {
    if (raf.current) return;
    const step = () => {
      const x = cursorX.current;
      let moving = false;
      for (const [key, el] of els.current) {
        const state = springs.current.get(key) ?? { k: 1, v: 0 };
        let target = 1;
        if (x !== null) {
          const centre = centres.current.get(key);
          if (centre !== undefined) {
            const d = Math.abs(x - centre);
            target = 1 + (MAG - 1) * Math.max(0, 1 - d / RANGE);
          }
        }
        const v = (state.v + (target - state.k) * STIFFNESS) * DAMPING;
        const k = state.k + v;
        if (Math.abs(target - k) > 0.002 || Math.abs(v) > 0.002) moving = true;
        springs.current.set(key, { k, v });
        el.style.transform = `scale(${k.toFixed(3)})`;
      }
      raf.current = moving ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  /** Centres are read once per entry, not per frame: growth is anchored
   *  bottom-centre, so no control's horizontal centre ever moves. */
  const measure = useCallback(() => {
    for (const [key, el] of els.current) {
      const r = el.getBoundingClientRect();
      centres.current.set(key, r.left + r.width / 2);
    }
  }, []);

  function onEnter(e: React.PointerEvent) {
    if (reduced.current || e.pointerType !== "mouse") return;
    measure();
    cursorX.current = e.clientX;
    run();
  }
  function onMove(e: React.PointerEvent) {
    if (reduced.current || e.pointerType !== "mouse") return;
    cursorX.current = e.clientX;
    run();
  }
  function onLeave() {
    cursorX.current = null;
    run();
  }

  // Arrow keys walk the controls, which is what a toolbar is expected to do
  // once it claims the role. Tab still moves past the whole bar in one step.
  const buttons = items.filter((i): i is DockButton => !isSeparator(i));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Exactly one control is tabbable, so Tab steps over the bar in one go and
  // the arrows walk inside it — the contract role="toolbar" promises.
  const activeKey = focusKey ?? buttons[0]?.key ?? "";
  function onKeyDown(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const order = buttons.map((b) => b.key);
    const here = order.indexOf((e.target as HTMLElement).dataset.dockKey ?? "");
    const next = order[(Math.max(0, here) + delta + order.length) % order.length];
    setFocusKey(next);
    els.current.get(next)?.focus();
  }

  return (
    <div
      ref={rowRef}
      role="toolbar"
      aria-label={label}
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onKeyDown={onKeyDown}
      // items-end: the wave grows upward, out of the bar, the way a dock does.
      className="pointer-events-auto flex items-end gap-1.5 rounded-full border border-border bg-surface/80 px-2 pb-1.5 pt-2 shadow-lg backdrop-blur-md"
    >
      {items.map((item) =>
        isSeparator(item) ? (
          <span key={item.key} className="mx-0.5 mb-1 h-5 w-px shrink-0 bg-border" />
        ) : (
          <span
            key={item.key}
            className="dock-slot relative flex shrink-0 items-end justify-center"
            style={{ width: item.width ?? BASE, height: BASE }}
          >
            {/* Outside the scaled button on purpose — a label that grew with
                the control would read as a zoom, not as a name. */}
            <span className="dock-label">{item.label}</span>
            <button
              ref={(el) => {
                // Only the element is dropped, never the spring: these ref
                // callbacks re-attach on every render, and clearing the spring
                // there would snap a control back to size mid-wave.
                if (el) els.current.set(item.key, el);
                else els.current.delete(item.key);
              }}
              data-dock-key={item.key}
              type="button"
              tabIndex={item.key === activeKey ? 0 : -1}
              onFocus={() => setFocusKey(item.key)}
              onClick={item.onClick}
              aria-label={item.label}
              style={{
                width: item.width ?? BASE,
                height: BASE,
                transformOrigin: "bottom center",
              }}
              className="flex items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:bg-surface-elevated focus-visible:text-foreground focus-visible:outline-none"
            >
              {item.text ? (
                <span className="font-mono text-[11px] font-semibold">{item.text}</span>
              ) : (
                item.icon
              )}
            </button>
          </span>
        ),
      )}
    </div>
  );
}
