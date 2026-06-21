"use client";

import { useState, type ReactNode } from "react";

export type SettingsTab = { id: string; label: string; content: ReactNode };

// Tabbed shell for the Settings page. Server-renders each section and passes it
// in; only tabs with content render. Keeps the (now crowded) page scannable.
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const visible = tabs.filter((t) => t.content);
  const [active, setActive] = useState(visible[0]?.id);

  if (visible.length === 0) return null;
  const current = visible.find((t) => t.id === active) ?? visible[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {visible.map((t) => {
          const on = t.id === current.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className={`-mb-px rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                on
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{current.content}</div>
    </div>
  );
}
