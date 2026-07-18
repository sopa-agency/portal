"use client";

import { useState, type ReactNode } from "react";
import { Wallet, Activity, PiggyBank } from "lucide-react";
import type { TreasuryGroup } from "@/lib/treasury";
import type { OrgRevenue } from "@/lib/org-revenue";
import type { FinancialDashboardView } from "@/lib/financial-dashboard";
import { FinancialDashboard } from "@/components/financial-dashboard";
import { TreasuryViews } from "@/components/treasury-views";
import { TreasuryRevenue } from "@/components/treasury-revenue";
import { Section } from "@/components/section-heading";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
  const projLabel = isAll ? "Tudo" : selected?.name ?? "";
  const h =
    runwayMonths == null
      ? { label: "Sem custos", phrase: "Nada saindo por aqui — o tesouro só acumula.", cls: "bg-success/15 text-success" }
      : runwayMonths >= 12
        ? { label: "Saudável", phrase: "O caixa cobre bem mais de um ano no ritmo atual.", cls: "bg-success/15 text-success" }
        : runwayMonths >= 3
          ? { label: "Atenção", phrase: "Menos de um ano de caixa — vale acompanhar de perto.", cls: "bg-warning/15 text-warning" }
          : { label: "Crítico", phrase: "Menos de 3 meses de caixa no ritmo atual.", cls: "bg-danger/15 text-danger" };

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
      <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="rounded-2xl border border-border bg-gradient-to-br from-accent-bg to-transparent p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
            <Wallet className="h-3.5 w-3.5" /> Tesouro · {projLabel}
          </div>
          <div className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight text-foreground">{usd(totalUsd)}</div>
          <p className="mt-1 text-xs text-foreground-faint">
            {walletCount > 0 ? `em ${walletCount} carteira${walletCount === 1 ? "" : "s"}` : "sem carteiras configuradas"}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground-faint">
            <Activity className="h-3.5 w-3.5" /> Saúde
          </div>
          <div className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${h.cls}`}>{h.label}</div>
          <p className="mt-1.5 text-xs text-foreground-muted">{h.phrase}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground-faint"
            title="Quanto tempo o caixa dura se o gasto continuar no ritmo atual."
          >
            <PiggyBank className="h-3.5 w-3.5" /> Runway
          </div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
            {runwayMonths == null ? "∞" : runwayMonths >= 10 ? Math.round(runwayMonths) : runwayMonths.toFixed(1)}
            {runwayMonths != null && <span className="ml-1 text-sm font-medium text-foreground-faint">meses</span>}
          </div>
          <p className="mt-1 text-xs text-foreground-faint">no ritmo de gasto atual</p>
        </div>
      </section>

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
