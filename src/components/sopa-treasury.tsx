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
import { dedupeTreasuryGroups } from "@/lib/treasury-aggregate";
import { useT } from "@/components/locale-provider";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// SOPA treasury dashboard: ONE project selector at the top that filters both
// the balances (TreasuryViews) and the on-chain revenue (TreasuryRevenue)
// together. "Tudo" shows the aggregate + the SOPA agency panel; picking a
// project narrows everything to that project.
export function SopaTreasury({
  groups,
  revenue,
  revenueError = false,
  dashboardViews,
  agency,
  part = "treasury",
}: {
  groups: TreasuryGroup[];
  revenue: OrgRevenue | null;
  /** The revenue READ failed (DB down) — show a failure, never an empty section. */
  revenueError?: boolean;
  dashboardViews: FinancialDashboardView[];
  /** SOPA-level agency revenue (jobs + split share) — shown only on "Tudo". */
  agency: ReactNode;
  /**
   * Which half to render. Balances and revenue are two questions — how much do
   * we have, and where does it come from — and each earns its own tab. They
   * share this component because they share the project FILTER: splitting them
   * into separate components would have meant two copies of that logic, and two
   * places for it to drift.
   */
  part?: "treasury" | "revenue";
}) {
  const t = useT().treasury;
  const [view, setView] = useState("all");
  const isAll = view === "all";
  const selected = groups.find((g) => g.slug === view);
  const visibleGroups = isAll ? dedupeTreasuryGroups(groups) : selected ? [selected] : groups;

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

  const tabs = [{ slug: "all", name: t.all }, ...groups.map((g) => ({ slug: g.slug, name: g.name }))];

  // Hero numbers for the current filter: how much, is it healthy, how long it lasts.
  const dash = dashboardViews.find((d) => d.slug === view) ?? dashboardViews[0];
  const totalUsd = visibleGroups.reduce((s, g) => s + g.report.grandTotalUsd, 0);
  const walletCount = visibleGroups.reduce((s, g) => s + g.report.evm.length + g.report.hive.length, 0);
  const runwayMonths = dash?.runwayMonths ?? null;
  const burnUsd = dash?.burnUsd ?? 0;
  const projLabel = isAll ? t.all : selected?.name ?? "";

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
            <span className="ml-1 text-[11px] text-foreground-faint">{t.filterHint}</span>
          </div>
        </div>
      )}

      {part === "revenue" ? (
        <>
          {/* Agency revenue is SOPA-level (not a single project) — only on "Tudo". */}
          {isAll && agency}

          {revenueError ? (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              ⚠ A receita não carregou (leitura do banco falhou) — desconhecido, não zero. Recarregue.
            </p>
          ) : filteredRevenue && filteredRevenue.projects.length > 0 ? (
            <TreasuryRevenue data={filteredRevenue} aggregate={isAll} />
          ) : (
            <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-muted">
              {t.sections.noRevenue}
            </p>
          )}
        </>
      ) : (
        <>
        {/* Hero: quanto temos · está saudável? · quanto tempo dura */}
        <TreasuryHealthHero
          label={projLabel}
          totalUsd={totalUsd}
          walletCount={walletCount}
          runwayMonths={runwayMonths}
          watermarkLogo="/projects/sopa/logo.png"
          runwayFooter={
            burnUsd > 0
              ? isAll
                ? t.hero.countingCostsAll(usd2(burnUsd))
                : t.hero.countingCosts(usd2(burnUsd))
              : t.hero.noCostsFiled
          }
        />

        <FinancialDashboard views={dashboardViews} selectedView={view} />

        <Section title={t.sections.where} hint={isAll ? t.sections.whereHintAll : t.sections.whereHint}>
          <TreasuryViews groups={visibleGroups} hideSelector hideTotal />
        </Section>
        </>
      )}
    </div>
  );
}
