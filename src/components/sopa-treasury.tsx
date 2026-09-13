"use client";

import { useState, type ReactNode } from "react";
import type { TreasuryGroup } from "@/lib/treasury";
import type { OrgRevenue } from "@/lib/org-revenue";
import type { FinancialDashboardView } from "@/lib/financial-dashboard";
import { TreasuryViews } from "@/components/treasury-views";
import { TreasuryHistoryChart } from "@/components/treasury-history-chart";
import type { TreasurySeries } from "@/lib/treasury-history";
import { TreasuryRevenue } from "@/components/treasury-revenue";
import { dedupeTreasuryGroups } from "@/lib/treasury-aggregate";
import { useT } from "@/components/locale-provider";
import { type Reading, isOk, ok } from "@/lib/reading";

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
  chartData,
  sopaOnly,
  sopaSlug,
  canPropose = false,
  vault,
}: {
  groups: TreasuryGroup[];
  /** Sessão válida — libera os botões de propor no card de cada multisig. */
  canPropose?: boolean;
  /** O cofre ligado aos multisigs (community-vaults é server-only, então desce
   *  como prop). */
  vault?: { key: string; assetSymbol: string; chainId: number };
  revenue: OrgRevenue | null;
  /** The revenue READ failed (DB down) — show a failure, never an empty section. */
  revenueError?: boolean;
  dashboardViews: FinancialDashboardView[];
  /** SOPA-level agency revenue (jobs + split share) — shown only on "Tudo". */
  agency: ReactNode;
  /**
   * Conteúdo que só faz sentido sob UM tesouro — hoje, os earmarks: eles são
   * porcentagem do caixa da SOPA, e nada dizem sobre a Gnars ou a SkateHive.
   *
   * Entra como slot, e não como irmão da página, porque a ABA MANDA. Enquanto
   * o card ficava do lado de fora, o filtro não o alcançava: a pessoa clicava
   * "SkateHive" e continuava lendo, logo abaixo, a destinação do dinheiro da
   * SOPA. Um filtro que não governa a tela inteira não é um filtro, é uma
   * sugestão.
   */
  sopaOnly?: ReactNode;
  /** A aba sob a qual `sopaOnly` aparece. Sem ela, o slot não é renderizado. */
  sopaSlug?: string;
  /**
   * O gráfico de saldo, como NÓ. Vem de fora porque a página é quem tem os
   * dados dele; aqui ele só ganha um lugar na grade, ao lado dos números.
   */
  /**
   * O que o gráfico precisa, cru — e não o gráfico pronto.
   *
   * Vinha renderizado da página, com todas as séries, e o seletor daqui não o
   * alcançava: era a queixa original desta tela. As séries já chegam dobradas
   * por projeto (cardId = slug), então filtrar é escolher a linha do escopo.
   */
  chartData?: {
    wallets: Reading<TreasurySeries[]>;
    streams: Reading<TreasurySeries[]>;
    failed: string[];
    initialLive: TreasurySeries[];
    initialSyncedAt: string | null;
  };
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
  // sumReadings refuses the sum when any group couldn't be read — that refusal
  // IS the feature. The names ride alongside so "incomplete" says what to chase.
  // O custo do ESCOPO, não o de todos. `dashboardViews` já traz o burn por
  // projeto (o custo do Claude é lançado na SOPA, e só nela). O #85 passava o
  // brandBurn — a soma de todos os projetos — para qualquer aba, e o runway da
  // SkateHive saía dividindo o caixa dela pelo custo da SOPA inteira.
  const burnUsd = dash?.burnUsd ?? 0;

  // O gráfico responde ao filtro. `key={view}` remonta o componente ao trocar
  // de escopo: ele guarda a série "ao vivo" da Zerion em estado interno, e uma
  // linha puxada para "Todos" não pode sobreviver dentro de "SkateHive".
  // `streams` fica inteiro: é indexado por card do org-chart, não por projeto,
  // e o gráfico só o usa quando não há série de carteira nenhuma.
  const chartNode = chartData
    ? (() => {
        const keep = (sr: TreasurySeries) => isAll || sr.cardId === view;
        const filtra = (r: Reading<TreasurySeries[]>): Reading<TreasurySeries[]> =>
          isOk(r) ? ok(r.value.filter(keep)) : r;
        return (
          <TreasuryHistoryChart
            key={view}
            wallets={filtra(chartData.wallets)}
            streams={chartData.streams}
            failed={chartData.failed}
            initialLive={chartData.initialLive.filter(keep)}
            initialSyncedAt={chartData.initialSyncedAt}
          />
        );
      })()
    : null;

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
              {t.views.revenueUnread}
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
        {/* Uma tela só: banda de KPIs, liquidez ao lado do gráfico, carteiras
            embaixo. O hero e o palco 7/5 que viviam aqui saíram — a banda de
            topo do Overview responde as mesmas perguntas, e dois totais na
            mesma página era o que o #85 tinha deixado. */}
        <TreasuryViews
          groups={visibleGroups}
          hideSelector
          canPropose={canPropose}
          vault={vault}
          monthlyBurnUsd={burnUsd}
          chart={chartNode}
        />

        {/* Só sob a aba da SOPA. Ver `sopaOnly` acima. */}
        {sopaSlug && view === sopaSlug && sopaOnly}
        </>
      )}
    </div>
  );
}
