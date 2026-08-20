"use client";

import { type ReactNode } from "react";
import { useUrlTab } from "@/lib/use-url-tab";

export type BriefingTab = {
  slug: string;
  label: string;
  content: ReactNode;
};

/**
 * Tab strip. Pass `paramKey` to make the active tab shareable (syncs to the
 * `?<paramKey>=<slug>` query param via useUrlTab). Each BriefingTabs instance on
 * a page needs its OWN paramKey. Without paramKey it's local state (as before).
 */
export function BriefingTabs({ tabs, initialSlug, paramKey }: { tabs: BriefingTab[]; initialSlug?: string; paramKey?: string }) {
  const [rawActive, setActive] = useUrlTab(paramKey, initialSlug ?? tabs[0]?.slug ?? "");
  const active = tabs.some((t) => t.slug === rawActive) ? rawActive : (initialSlug ?? tabs[0]?.slug ?? "");
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
