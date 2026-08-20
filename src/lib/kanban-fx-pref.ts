"use client";

// Per-device preference for the Kanban card visual effects (the animated
// fire/frost canvas overlays in CardFx). Stored in localStorage — it's a
// performance/taste choice per machine, not per account — so low-performance
// computers can turn the canvas animations off. Effects are ON by default.

import { useEffect, useState } from "react";

const KEY = "sopa:kanban-fx";
const EVENT = "sopa:kanban-fx-change";

/** Read the current preference. Defaults to ON (anything but the "off" sentinel). */
export function getKanbanFxEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Persist the preference and notify listeners in this tab + other tabs. */
export function setKanbanFxEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    // ignore (private mode / storage disabled)
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Reactive hook: re-renders when the preference changes (this tab or another). */
export function useKanbanFxEnabled(): boolean {
  // Start ON to match SSR/first paint (default), then reconcile from storage.
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const sync = () => setEnabled(getKanbanFxEnabled());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync); // cross-tab
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return enabled;
}
