"use client";

import { useState, type ReactNode } from "react";
import type { TreasuryGroup } from "@/lib/treasury";
import type { OrgRevenue } from "@/lib/org-revenue";
import { TreasuryViews } from "@/components/treasury-views";
import { TreasuryRevenue } from "@/components/treasury-revenue";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// SOPA treasury dashboard: ONE project selector at the top that filters both
// the balances (TreasuryViews) and the on-chain revenue (TreasuryRevenue)
// together. "Tudo" shows the aggregate + the SOPA agency panel; picking a
// project narrows everything to that project.
export function SopaTreasury({
  groups,
  revenue,
  agency,
}: {
  groups: TreasuryGroup[];
  revenue: OrgRevenue | null;
  /** SOPA-level agency revenue (jobs + split share) — shown only on "Tudo". */
  agency: ReactNode;
}) {
  const [view, setView] = useState("all");
  const isAll = view === "all";
  const selected = groups.find((g) => g.slug === view);
  const visibleGroups = isAll ? groups : selected ? [selected] : groups;

  const filteredRevenue: OrgRevenue | null = !revenue
    ? null
    : isAll
      ? revenue
      : (() => {
          const projects = revenue.projects.filter(
            (p) => selected && (norm(p.name) === norm(selected.name) || norm(p.name) === norm(selected.slug)),
          );
          return {
            projects,
            balanceTotalUsd: projects.reduce((s, p) => s + p.balanceTotalUsd, 0),
            realizedTotalUsd: projects.reduce((s, p) => s + p.realizedTotalUsd, 0),
          };
        })();

  const tabs = [{ slug: "all", name: "Tudo" }, ...groups.map((g) => ({ slug: g.slug, name: g.name }))];

  return (
    <div className="space-y-8">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => setView(t.slug)}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                view === t.slug
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <TreasuryViews groups={visibleGroups} hideSelector />

      {/* Agency revenue is SOPA-level (not a single project) — only on "Tudo". */}
      {isAll && agency}

      {filteredRevenue && filteredRevenue.projects.length > 0 && (
        <TreasuryRevenue data={filteredRevenue} aggregate={isAll} />
      )}
    </div>
  );
}
