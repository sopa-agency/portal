"use client";

import { Network, TrendingUp } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { SopaOrgChart, type Person } from "@/components/sopa-org-chart";
import { OrgRevenueOrbit } from "@/components/org-revenue-orbit";
import type { BoardCard } from "@/app/actions/sopa-boards";
import type { SopaRevenueOrbit } from "@/lib/sopa-revenue-orbit";

// Two views of the org-chart, toggled (and URL-persisted): the org STRUCTURE
// (who's who, tiers, teams — SopaOrgChart) and the money view — every project's
// swap-split / auction revenue flowing INTO the SOPA treasury (OrgRevenueOrbit).
export function OrgChartViews({
  cards,
  roster,
  orbit,
}: {
  cards: BoardCard[];
  roster: Person[];
  orbit: SopaRevenueOrbit;
}) {
  const [view, setView] = useUrlTab("view", "estrutura");
  const active = view === "receita" ? "receita" : "estrutura";

  return (
    <div className="space-y-6">
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-surface p-1">
        {([["estrutura", "Estrutura", Network], ["receita", "Receita", TrendingUp]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={active === id}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active === id ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {active === "estrutura" ? <SopaOrgChart initial={cards} roster={roster} /> : <OrgRevenueOrbit orbit={orbit} />}
    </div>
  );
}
