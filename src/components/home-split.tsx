"use client";

import { type ReactNode } from "react";
import { FileText, Megaphone, type LucideIcon } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { useT } from "@/components/locale-provider";
import { SummaryBand, type BandTile } from "@/components/summary-band";

// Home layout: Morning brief and Socials split into two TOP-LEVEL tabs. Morning
// brief shows every agent side by side; Socials uses its metric tiles AS the
// channel selector (no duplicate sub-switcher).

export type SplitTab = {
  slug: string;
  label: string;
  content: ReactNode;
};

export function HomeTabs({
  briefTabs,
  channelTabs,
  briefAbove,
  socialTiles,
  socialAside,
}: {
  briefTabs: SplitTab[];
  channelTabs: SplitTab[];
  /** Rendered above the Morning brief content (e.g. the user's own tasks). */
  briefAbove?: ReactNode;
  /** Social metric tiles — double as the channel selector on the Socials tab. */
  socialTiles?: BandTile[];
  /** Side panel on the Socials tab (e.g. upcoming posts + calendar). */
  socialAside?: ReactNode;
}) {
  const t = useT().home.tabs;
  const views: { id: string; label: string; icon: LucideIcon }[] = [];
  if (briefTabs.length) views.push({ id: "briefing", label: t.brief, icon: FileText });
  if (channelTabs.length) views.push({ id: "social", label: t.socials, icon: Megaphone });

  const [view, setView] = useUrlTab("view", views[0]?.id ?? "briefing");
  const [socialActive, setSocialActive] = useUrlTab("social", channelTabs[0]?.slug ?? "");

  const activeView = views.find((v) => v.id === view) ?? views[0];
  const currentChannel = channelTabs.find((t) => t.slug === socialActive) ?? channelTabs[0];

  if (!views.length) return null;

  const showingBrief = activeView?.id === "briefing";

  return (
    <div>
      {/* Top-level tabs (hidden when only one section exists). */}
      {views.length > 1 && (
        <div className="mb-6 flex gap-1 border-b border-border" role="tablist">
          {views.map((v) => {
            const Icon = v.icon;
            const on = v.id === activeView?.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setView(v.id)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors ${
                  on
                    ? "border-accent text-accent"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      <div role="tabpanel">
        {showingBrief ? (
          <>
            {briefAbove ? <div className="mb-6">{briefAbove}</div> : null}
            {/* Show every briefing agent side by side (DEV ∥ MKT) instead of a
                switcher — the full-width tab has room for both at once. */}
            {briefTabs.length > 1 ? (
              <div className="grid gap-8 lg:grid-cols-2 lg:gap-6">
                {briefTabs.map((t) => (
                  <section key={t.slug} className="min-w-0">
                    <div className="mb-4 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                      {t.label}
                    </div>
                    {t.content}
                  </section>
                ))}
              </div>
            ) : (
              <div>{briefTabs[0]?.content}</div>
            )}
          </>
        ) : (
          <>
            {socialTiles && socialTiles.length > 0 && (
              <div className="mb-6 flex justify-center">
                {/* Tiles ARE the channel selector — click a channel's metric to switch. */}
                <SummaryBand tiles={socialTiles} activeSlug={currentChannel?.slug} onSelect={setSocialActive} />
              </div>
            )}
            {socialAside ? (
              // Split: the selected channel (recent posts) + the posts calendar aside.
              <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <div className="min-w-0">{currentChannel?.content}</div>
                <div className="min-w-0">{socialAside}</div>
              </div>
            ) : (
              <div>{currentChannel?.content}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
