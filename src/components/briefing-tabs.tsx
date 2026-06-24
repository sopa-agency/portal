"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type BriefingTab = {
  slug: string;
  label: string;
  content: ReactNode;
};

/**
 * Tab strip. Pass `paramKey` to make the active tab shareable: it syncs to the
 * `?<paramKey>=<slug>` query param (so a copied URL opens the same tab). Each
 * BriefingTabs instance on a page needs its OWN paramKey to avoid collisions.
 * Without paramKey it falls back to local state (non-shareable, as before).
 */
export function BriefingTabs({ tabs, initialSlug, paramKey }: { tabs: BriefingTab[]; initialSlug?: string; paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localActive, setLocalActive] = useState(initialSlug ?? tabs[0]?.slug ?? "");

  const urlSlug = paramKey ? searchParams.get(paramKey) : null;
  const active = paramKey
    ? (urlSlug && tabs.some((t) => t.slug === urlSlug) ? urlSlug : (initialSlug ?? tabs[0]?.slug ?? ""))
    : localActive;
  const current = tabs.find((t) => t.slug === active) ?? tabs[0];

  const setActive = (slug: string) => {
    if (!paramKey) { setLocalActive(slug); return; }
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramKey, slug);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

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
