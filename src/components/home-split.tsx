"use client";

import { type ReactNode } from "react";
import { FileText, Megaphone, type LucideIcon } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";

// Home layout: Morning brief and Socials split into two TOP-LEVEL tabs (was a
// side-by-side "Split Desk") so the page reads one thing at a time. Each tab
// keeps its own segmented sub-switcher (per briefing agent / per channel).

export type SplitTab = {
  slug: string;
  label: string;
  content: ReactNode;
};

// Small segmented sub-switcher within a tab (DEV/MKT, Instagram/Farcaster…).
function Seg({
  tabs,
  active,
  onChange,
}: {
  tabs: SplitTab[];
  active: string;
  onChange: (slug: string) => void;
}) {
  if (tabs.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-0.5 rounded-lg bg-surface-elevated p-0.5">
      {tabs.map((t) => (
        <button
          key={t.slug}
          type="button"
          role="tab"
          aria-selected={t.slug === active}
          onClick={() => onChange(t.slug)}
          className={`rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors ${
            t.slug === active
              ? "bg-surface text-accent shadow-sm"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function HomeTabs({
  briefTabs,
  channelTabs,
  briefAbove,
  briefBand,
  socialBand,
}: {
  briefTabs: SplitTab[];
  channelTabs: SplitTab[];
  /** Rendered above the Morning brief content (e.g. the user's own tasks). */
  briefAbove?: ReactNode;
  /** At-a-glance tiles shown at the top of the Morning brief tab (under the tabs). */
  briefBand?: ReactNode;
  /** At-a-glance tiles shown at the top of the Socials tab (under the tabs). */
  socialBand?: ReactNode;
}) {
  const views: { id: string; label: string; icon: LucideIcon }[] = [];
  if (briefTabs.length) views.push({ id: "briefing", label: "Morning brief", icon: FileText });
  if (channelTabs.length) views.push({ id: "social", label: "Socials", icon: Megaphone });

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
            {briefBand ? <div className="mb-6">{briefBand}</div> : null}
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
            {socialBand ? <div className="mb-6">{socialBand}</div> : null}
            {channelTabs.length > 1 && (
              <div className="mb-5 overflow-x-auto">
                <Seg tabs={channelTabs} active={currentChannel?.slug ?? ""} onChange={setSocialActive} />
              </div>
            )}
            <div>{currentChannel?.content}</div>
          </>
        )}
      </div>
    </div>
  );
}
