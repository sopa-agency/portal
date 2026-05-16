"use client";

import { useState, type ReactNode } from "react";

export type BriefingTab = {
  slug: string;
  label: string;
  content: ReactNode;
};

export function BriefingTabs({ tabs, initialSlug }: { tabs: BriefingTab[]; initialSlug?: string }) {
  const [active, setActive] = useState(initialSlug ?? tabs[0]?.slug ?? "");
  const current = tabs.find((t) => t.slug === active) ?? tabs[0];

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const isActive = t.slug === current?.slug;
          return (
            <button
              key={t.slug}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.slug)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{current?.content}</div>
    </div>
  );
}
