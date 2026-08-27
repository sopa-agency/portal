"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Network, TrendingUp, BookText } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { useT } from "@/components/locale-provider";
import { SopaOrgChart, type Person } from "@/components/sopa-org-chart";
import { OrgRevenueOrbit } from "@/components/org-revenue-orbit";
import { AddressBook } from "@/components/address-book";
import type { BoardCard } from "@/app/actions/sopa-boards";
import type { SopaRevenueOrbit, SopaSupport } from "@/lib/sopa-revenue-orbit";
import type { AddressBookEntry } from "@/lib/address-book";
import type { BridgeFeeSummary } from "@/lib/bridge-fee-inflows";

const TABS = [
  { key: "structure", icon: Network },
  { key: "revenue", icon: TrendingUp },
  { key: "addresses", icon: BookText },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Three views of the org-chart, toggled (and URL-persisted): the org STRUCTURE
// (who's who, tiers, teams — SopaOrgChart), the money view (revenue flowing INTO
// the SOPA treasury + community backers — OrgRevenueOrbit), and the ADDRESS BOOK
// (every tracked on-chain address, with ENS resolution + suggestions).
export function OrgChartViews({
  cards,
  roster,
  orbit,
  support,
  addressBook,
  bridgeFee,
}: {
  cards: BoardCard[];
  roster: Person[];
  orbit: SopaRevenueOrbit;
  support: SopaSupport;
  addressBook: AddressBookEntry[];
  bridgeFee?: BridgeFeeSummary;
}) {
  const t = useT().orgChart.views;
  const [view, setView] = useUrlTab("view", "structure");
  const active: TabKey = view === "revenue" || view === "addresses" ? view : "structure";

  // Sliding thumb, same treatment as the rest of the portal's tab bars: the
  // geometry is written to the DOM as custom properties, not held in state.
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<TabKey, HTMLButtonElement>());

  const positionThumb = useCallback(() => {
    const list = listRef.current;
    const button = buttonRefs.current.get(active);
    if (!list || !button) return;
    list.style.setProperty("--seg-x", `${button.offsetLeft}px`);
    list.style.setProperty("--seg-w", `${button.offsetWidth}px`);
  }, [active]);

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

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = TABS.findIndex((x) => x.key === active);
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    setView(next.key);
    buttonRefs.current.get(next.key)?.focus();
  };

  return (
    // The structure view is a canvas: it needs a DEFINITE height to fill, which
    // a plain flow container can't give it. The column below the tab bar is what
    // supplies it (viewport minus the shell's own padding + this header).
    <div className="flex min-h-[calc(100vh-6.5rem)] flex-col gap-5">
      <div
        ref={listRef}
        role="tablist"
        aria-label={t.label}
        onKeyDown={onKeyDown}
        className="segmented inline-flex w-fit rounded-xl border border-border p-1"
      >
        <span className="segmented-thumb" aria-hidden="true" />
        {TABS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            ref={(node) => {
              if (node) buttonRefs.current.set(key, node);
              else buttonRefs.current.delete(key);
            }}
            type="button"
            role="tab"
            aria-selected={active === key}
            tabIndex={active === key ? 0 : -1}
            onClick={() => setView(key)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
              active === key ? "text-foreground" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon className={`h-4 w-4 transition-colors duration-200 ${active === key ? "text-accent" : ""}`} />
            {t[key]}
          </button>
        ))}
      </div>

      {active === "structure" ? (
        <SopaOrgChart initial={cards} roster={roster} />
      ) : active === "revenue" ? (
        <OrgRevenueOrbit orbit={orbit} support={support} />
      ) : (
        <AddressBook entries={addressBook} bridgeFee={bridgeFee} />
      )}
    </div>
  );
}
