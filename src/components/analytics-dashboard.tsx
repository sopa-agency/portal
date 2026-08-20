"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ga4Panel } from "@/components/analytics-ga4";
import { GscPanel } from "@/components/analytics-gsc";
import { AnalyticsInsights } from "@/components/analytics-insights";
import { useT } from "@/components/locale-provider";

type Days = 7 | 28 | 90;
type TabSlug = "ga4" | "gsc";

export function AnalyticsDashboard({ agentName }: { agentName?: string }) {
  const t = useT().analytics;
  const [days, setDays] = useState<Days>(28);
  const [activeTab, setActiveTab] = useState<TabSlug>("ga4");

  const tabs = [
    { slug: "ga4" as const, ...t.tabs.audience },
    { slug: "gsc" as const, ...t.tabs.search },
  ];
  const ranges: { value: Days; label: string }[] = [
    { value: 7, label: t.range.d7 },
    { value: 28, label: t.range.d28 },
    { value: 90, label: t.range.d90 },
  ];
  const current = tabs.find((x) => x.slug === activeTab) ?? tabs[0];

  // ── Sliding indicators ────────────────────────────────────────────────────
  // Both controls measure their active child and hand the geometry to CSS, so
  // the marker travels instead of blinking from one place to another. Same
  // technique as the Post Suggestions switcher.
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const rangeRef = useRef<HTMLDivElement>(null);
  const rangeButtons = useRef(new Map<number, HTMLButtonElement>());

  const place = useCallback(
    (list: HTMLElement | null, button: HTMLElement | undefined, prefix: string) => {
      if (!list || !button) return;
      list.style.setProperty(`--${prefix}-x`, `${button.offsetLeft}px`);
      list.style.setProperty(`--${prefix}-w`, `${button.offsetWidth}px`);
    },
    [],
  );

  const position = useCallback(() => {
    place(tabsRef.current, tabButtons.current.get(activeTab), "tab");
    place(rangeRef.current, rangeButtons.current.get(days), "seg");
  }, [activeTab, days, place]);

  useLayoutEffect(() => {
    position();
    const id = requestAnimationFrame(() => {
      tabsRef.current?.setAttribute("data-ready", "true");
      rangeRef.current?.setAttribute("data-ready", "true");
    });
    return () => cancelAnimationFrame(id);
  }, [position]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    for (const node of [tabsRef.current, rangeRef.current]) if (node) observer.observe(node);
    for (const node of tabButtons.current.values()) observer.observe(node);
    for (const node of rangeButtons.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [position]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          ref={tabsRef}
          role="tablist"
          aria-label={t.title}
          className="underline-tabs flex gap-1 border-b border-border"
        >
          <span className="underline-tabs-thumb" aria-hidden="true" />
          {tabs.map((tab) => (
            <button
              key={tab.slug}
              ref={(node) => {
                if (node) tabButtons.current.set(tab.slug, node);
                else tabButtons.current.delete(tab.slug);
              }}
              type="button"
              role="tab"
              aria-selected={tab.slug === activeTab}
              onClick={() => setActiveTab(tab.slug)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab.slug === activeTab
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters in one row above everything they scope (dataviz). */}
        <div
          ref={rangeRef}
          role="group"
          aria-label={t.range.label}
          className="segmented flex rounded-lg border border-border p-1"
        >
          <span className="segmented-thumb" aria-hidden="true" />
          {ranges.map((option) => (
            <button
              key={option.value}
              ref={(node) => {
                if (node) rangeButtons.current.set(option.value, node);
                else rangeButtons.current.delete(option.value);
              }}
              type="button"
              aria-pressed={days === option.value}
              onClick={() => setDays(option.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium tabular-nums transition-colors ${
                days === option.value
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* What this tab answers, and where its numbers come from. The tab label
          alone said only which Google product it was. */}
      <p className="-mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-subtle">
        {current.blurb}
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-faint">
          {current.source}
        </span>
      </p>

      <AnalyticsInsights days={days} agentName={agentName} />

      <div key={activeTab} role="tabpanel" className="tab-panel">
        {activeTab === "ga4" ? <Ga4Panel days={days} /> : <GscPanel days={days} />}
      </div>
    </div>
  );
}
