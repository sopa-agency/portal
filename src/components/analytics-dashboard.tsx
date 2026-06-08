"use client";

import { useState } from "react";
import { Ga4Panel } from "@/components/analytics-ga4";
import { GscPanel } from "@/components/analytics-gsc";
import { AnalyticsInsights } from "@/components/analytics-insights";

type Days = 7 | 28 | 90;
type TabSlug = "ga4" | "gsc";

const RANGE_OPTIONS: { label: string; value: Days }[] = [
  { label: "7d", value: 7 },
  { label: "28d", value: 28 },
  { label: "90d", value: 90 },
];

const TABS: { slug: TabSlug; label: string }[] = [
  { slug: "ga4", label: "Google Analytics" },
  { slug: "gsc", label: "Search Console" },
];

export function AnalyticsDashboard({ agentName }: { agentName?: string }) {
  const [days, setDays] = useState<Days>(28);
  const [activeTab, setActiveTab] = useState<TabSlug>("ga4");

  return (
    <div className="space-y-6">
      {/* Range selector + tabs header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Tab switcher */}
        <div role="tablist" className="flex gap-1 border-b border-border">
          {TABS.map((t) => {
            const isActive = t.slug === activeTab;
            return (
              <button
                key={t.slug}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(t.slug)}
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

        {/* Range segmented buttons */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-elevated p-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDays(opt.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                days === opt.value
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Insights panel — spans both tabs */}
      <AnalyticsInsights days={days} agentName={agentName} />

      {/* Active tab panel */}
      <div role="tabpanel">
        {activeTab === "ga4" ? (
          <Ga4Panel days={days} />
        ) : (
          <GscPanel days={days} />
        )}
      </div>
    </div>
  );
}
