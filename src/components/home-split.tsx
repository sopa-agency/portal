"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
  briefTop,
  socialTiles,
  socialAside,
}: {
  briefTabs: SplitTab[];
  channelTabs: SplitTab[];
  /** Rendered above the Morning brief content (e.g. the user's own tasks). */
  briefAbove?: ReactNode;
  /** Leads the Morning brief tab — the day's next actions, both agents. */
  briefTop?: ReactNode;
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

  // Geometry straight to the DOM: the underline follows the active tab, and
  // recomputing it shouldn't cost a render. See .underline-tabs in globals.
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeId = activeView?.id;

  const positionThumb = useCallback(() => {
    const list = listRef.current;
    const button = activeId ? buttonRefs.current.get(activeId) : undefined;
    if (!list || !button) return;
    list.style.setProperty("--tab-x", `${button.offsetLeft}px`);
    list.style.setProperty("--tab-w", `${button.offsetWidth}px`);
  }, [activeId]);

  useLayoutEffect(() => {
    positionThumb();
    const id = requestAnimationFrame(() => listRef.current?.setAttribute("data-ready", "true"));
    return () => cancelAnimationFrame(id);
  }, [positionThumb]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(positionThumb);
    observer.observe(list);
    for (const button of buttonRefs.current.values()) observer.observe(button);
    return () => observer.disconnect();
  }, [positionThumb]);
  const currentChannel = channelTabs.find((t) => t.slug === socialActive) ?? channelTabs[0];

  if (!views.length) return null;

  const showingBrief = activeView?.id === "briefing";

  return (
    <div>
      {/* Top-level tabs (hidden when only one section exists). */}
      {views.length > 1 && (
        <div
          ref={listRef}
          className="underline-tabs mb-6 flex gap-1 border-b border-border"
          role="tablist"
        >
          <span className="underline-tabs-thumb" aria-hidden="true" />
          {views.map((v) => {
            const Icon = v.icon;
            const on = v.id === activeView?.id;
            return (
              <button
                key={v.id}
                ref={(node) => {
                  if (node) buttonRefs.current.set(v.id, node);
                  else buttonRefs.current.delete(v.id);
                }}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setView(v.id)}
                // The CSS border is the pre-hydration underline: the sliding
                // thumb has no width until JS measures the tab, so without this
                // the first paint (and a JS-off render) shows no active marker.
                // .underline-tabs[data-ready] hides it once the thumb takes over.
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

      <div role="tabpanel" key={activeView?.id} className="tab-panel">
        {showingBrief ? (
          <>
            {briefTop ? <div className="mb-6">{briefTop}</div> : null}
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
