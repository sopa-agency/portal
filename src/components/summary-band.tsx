"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";

export type BandTile = {
  label: string;
  value: string;
  delta?: number | null;
  sub?: string;
  tone?: "ok" | "warn";
  /** Social platform name — renders the brand mark next to the label. */
  platform?: string;
  /** When set + onSelect provided, the tile acts as a selector for this slug. */
  slug?: string;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Compact at-a-glance band. Display-only by default; pass onSelect (+ per-tile
// slug) to turn the tiles into a selector (used as the Socials channel picker).
export function SummaryBand({
  tiles,
  activeSlug,
  onSelect,
}: {
  tiles: BandTile[];
  activeSlug?: string;
  onSelect?: (slug: string) => void;
}) {
  if (tiles.length === 0) return null;
  const selectable = !!onSelect;

  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-surface">
      {tiles.map((t, i) => {
        const active = selectable && !!t.slug && t.slug === activeSlug;
        const cls = `flex min-w-[84px] flex-col gap-0.5 px-3 py-1.5 text-left ${
          i < tiles.length - 1 ? "border-r border-border" : ""
        } ${active ? "bg-accent-bg" : ""} ${selectable && t.slug ? "transition-colors hover:bg-foreground/5" : ""}`;
        const inner = (
          <>
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-foreground-faint">
              {t.platform && <SocialBrandIcon platform={t.platform} className="h-2.5 w-2.5 shrink-0" />}
              {t.tone && (
                <span
                  className={`h-[6px] w-[6px] shrink-0 rounded-full ${t.tone === "ok" ? "bg-success" : "bg-warning"}`}
                  aria-hidden
                />
              )}
              <span className="whitespace-nowrap">{t.label}</span>
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-base font-bold leading-none tracking-tight ${active ? "text-accent" : "text-foreground"}`}>
                {t.value}
              </span>
              {t.delta != null && t.delta !== 0 ? (
                <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${t.delta > 0 ? "text-success" : "text-danger"}`}>
                  {t.delta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                  {t.delta > 0 ? "+" : ""}
                  {fmt(t.delta)}
                </span>
              ) : (
                <span className="whitespace-nowrap text-[10px] text-foreground-faint">{t.sub ?? "—"}</span>
              )}
            </div>
          </>
        );
        return selectable && t.slug ? (
          <button key={`${t.label}-${i}`} type="button" aria-pressed={active} onClick={() => onSelect!(t.slug!)} className={cls}>
            {inner}
          </button>
        ) : (
          <div key={`${t.label}-${i}`} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
