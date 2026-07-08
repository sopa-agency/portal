"use client";

import { Sparkles } from "lucide-react";
import { getKanbanFxEnabled, setKanbanFxEnabled, useKanbanFxEnabled } from "@/lib/kanban-fx-pref";

/**
 * Settings toggle for the Kanban card visual effects (animated fire/frost canvas
 * overlays). Off = lighter on low-performance machines. Per-device (localStorage).
 */
export function KanbanFxToggle() {
  const enabled = useKanbanFxEnabled();

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Efeitos visuais do Kanban</p>
            <p className="mt-0.5 text-xs text-foreground-muted">
              Animações de fogo e gelo nos cards em chamas (5🔥) e atrasados. Desligue em
              computadores mais lentos para melhorar o desempenho do board.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Efeitos visuais do Kanban"
          onClick={() => setKanbanFxEnabled(!getKanbanFxEnabled())}
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
            enabled ? "border-accent-border bg-accent" : "border-border bg-surface-elevated"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </section>
  );
}
