"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Accessibility plumbing for hand-rolled modals (the house pattern — no Radix in
 * this repo). Wire it to the dialog *panel* ref and its close handler; it then:
 *  - locks body scroll while open,
 *  - captures the element focused before open and restores it on close,
 *  - moves initial focus into the panel (the panel itself, so SR reads its label),
 *  - traps Tab / Shift+Tab inside the panel,
 *  - closes on Escape.
 *
 * The panel must have `tabIndex={-1}` so the fallback `.focus()` works.
 */
export function useDialogA11y(panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  // Always call the latest onClose without re-running the (mount-once) effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Initial focus on the panel itself — it carries aria-label, so screen
    // readers announce the dialog from the top.
    panel?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // Mount-once: the panel ref and close handler are stable via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
