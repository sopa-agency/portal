"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A panel that floats next to the element that opened it.
 *
 * Why a portal instead of `position: absolute` next to the trigger: two of the
 * callers sit inside a scroll container (a Kanban column) or a modal, and an
 * absolutely positioned panel gets clipped by the first ancestor that scrolls.
 * A native <select> never had that problem because the browser draws its list
 * outside the page; portalling to <body> with `position: fixed` buys the same
 * freedom back.
 *
 * React events still bubble through the REACT tree, not the DOM tree, so a
 * click inside the panel is seen by the ancestors that rendered it — which is
 * what keeps the card dialog's "click the backdrop to close" from firing when
 * you pick an option.
 *
 * The panel stays mounted while closed so the close animates (see
 * .popover-panel in globals.css); `inert` keeps it out of tab order and off the
 * a11y tree in the meantime.
 */
export function AnchoredPopover({
  open,
  onClose,
  anchorRef,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The trigger. Drives position, and clicks on it don't count as "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Rendering into <body> has to wait for the client: this component is used
  // inside client components, which Next still renders once on the server.
  const [host, setHost] = useState<HTMLElement | null>(null);
  // Rendering nothing until after hydration is the point here: reading
  // `document` during render would put a portal in the client's first pass that
  // the server never sent.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setHost(document.body), []);

  /**
   * Position imperatively rather than through state: this also runs on every
   * scroll frame while open, and a re-render per frame would be wasteful. It
   * measures the panel AFTER pinning its min-width to the trigger, since that
   * width is what decides how the content wraps and therefore how tall it is.
   */
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const a = anchor.getBoundingClientRect();
    panel.style.minWidth = `${a.width}px`;
    // offsetWidth/Height, NOT getBoundingClientRect: the panel is mid-transition
    // when this first runs (it opens from scale(0.97)), and the rect would
    // report the shrunken, animating box. The offset pair ignores transforms.
    const { offsetHeight: height, offsetWidth: width } = panel;

    const gap = 6;
    const margin = 8;
    const spaceBelow = window.innerHeight - a.bottom;
    // Flip up only when below genuinely doesn't fit AND above is roomier —
    // otherwise a panel near the bottom would flip on every small viewport.
    const flipUp = height + gap > spaceBelow && a.top > spaceBelow;

    panel.style.top = `${flipUp ? Math.max(margin, a.top - height - gap) : a.bottom + gap}px`;
    panel.style.left = `${Math.max(margin, Math.min(a.left, window.innerWidth - width - margin))}px`;
    // Grow from the edge nearest the trigger, so the panel looks like it comes
    // out of the button rather than drifting in from nowhere.
    panel.style.transformOrigin = flipUp ? "bottom left" : "top left";
    panel.style.setProperty("--pop-y", flipUp ? "6px" : "-6px");
  }, [anchorRef]);

  // Before paint, so the panel is never briefly visible in the wrong place.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // Capture, so scrolling ANY ancestor (a Kanban column, the dialog body)
    // keeps the panel glued to its trigger rather than stranded mid-screen.
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    // Escape is listened for on WINDOW in the capture phase on purpose: the card
    // dialog closes itself from a capture listener on `document`, and capture
    // runs window → document, so this one gets to swallow the key first. Without
    // it, dismissing the dropdown would close the whole dialog behind it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, place, anchorRef]);

  if (!host) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-open={open}
      inert={!open}
      className={`popover-panel fixed z-[60] rounded-xl border border-border bg-surface-elevated shadow-xl ${className}`}
    >
      {children}
    </div>,
    host,
  );
}
