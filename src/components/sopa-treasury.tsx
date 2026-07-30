"use client";

import { useState, type ReactNode } from "react";
import type { TreasuryGroup } from "@/lib/treasury";
import type { OrgRevenue } from "@/lib/org-revenue";
import type { FinancialDashboardView } from "@/lib/financial-dashboard";
import { FinancialDashboard } from "@/components/financial-dashboard";
import { TreasuryViews } from "@/components/treasury-views";
import { TreasuryRevenue } from "@/components/treasury-revenue";
import { Section } from "@/components/section-heading";
import { usd as usd2 } from "@/lib/format";
import { TreasuryHealthHero } from "@/components/treasury-health-hero";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// SOPA treasury dashboard: ONE project selector at the top that filters both
// the balances (TreasuryViews) and the on-chain revenue (TreasuryRevenue)
// together. "Tudo" shows the aggregate + the SOPA agency panel; picking a
// project narrows everything to that project.
export function SopaTreasury({
  groups,
  revenue,
  dashboardViews,
  agency,
}: {
  groups: TreasuryGroup[];
  revenue: OrgRevenue | null;
  dashboardViews: FinancialDashboardView[];
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

  // Hero numbers for the current filter: how much, is it healthy, how long it lasts.
  const dash = dashboardViews.find((d) => d.slug === view) ?? dashboardViews[0];
  const totalUsd = visibleGroups.reduce((s, g) => s + g.report.grandTotalUsd, 0);
  const walletCount = visibleGroups.reduce((s, g) => s + g.report.evm.length + g.report.hive.length, 0);
  const runwayMonths = dash?.runwayMonths ?? null;
  const burnUsd = dash?.burnUsd ?? 0;
  const projLabel = isAll ? "Tudo" : selected?.name ?? "";

  return (
    <div className="space-y-8">
      {groups.length > 1 && (
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.slug}
                type="button"
                onClick={() => setView(t.slug)}
                aria-pressed={view === t.slug}
                className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  view === t.slug
                    ? "border-accent-border bg-accent-bg text-accent"
                    : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
                }`}
              >
                {t.name}
              </button>
            ))}
            <span className="ml-1 text-[11px] text-foreground-faint">o filtro ajusta todos os números abaixo</span>
          </div>
        </div>
      )}

      {/* Hero: quanto temos · está saudável? · quanto tempo dura */}
      <TreasuryHealthHero
        label={projLabel}
        totalUsd={totalUsd}
        walletCount={walletCount}
        runwayMonths={runwayMonths}
        watermarkLogo="/projects/sopa/logo.png"
        runwayFooter={
          burnUsd > 0
            ? `contando ${usd2(burnUsd)}/mês de custos${isAll ? " de todos os projetos" : ""}`
            : "nenhum custo fixo lançado neste filtro"
        }
      />

      <FinancialDashboard views={dashboardViews} selectedView={view} />

      <Section
        title="Onde o dinheiro está"
        hint={`Cada carteira e ativo que compõe o tesouro${isAll ? ", somando todos os projetos" : ""}.`}
      >
        <TreasuryViews groups={visibleGroups} hideSelector hideTotal />
      </Section>

      {/* Agency revenue is SOPA-level (not a single project) — only on "Tudo". */}
      {isAll && agency}

      {filteredRevenue && filteredRevenue.projects.length > 0 && (
        <TreasuryRevenue data={filteredRevenue} aggregate={isAll} />
      )}
    </div>
  );
}
