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
import { sumReadings } from "@/lib/reading";

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
  chart,
  sopaOnly,
  sopaSlug,
}: {
  groups: TreasuryGroup[];
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
  chart?: ReactNode;
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
  const total = sumReadings(visibleGroups.map((g) => g.report.total));
  const unreadLabels = visibleGroups.flatMap((g) => g.report.unreadLabels);
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
        {/*
          A CURVA E OS NÚMEROS DIVIDEM O PALCO, lado a lado.
          
          Antes o gráfico ocupava a largura inteira e empurrava total, saúde e
          "onde está o dinheiro" para baixo da dobra: para ver quanto se tem era
          preciso rolar por cima de um gráfico que responde outra pergunta.
          
          Agora são 7 colunas para a curva e 5 para os números — as duas
          perguntas que se olham juntas ficam juntas. "Onde está o dinheiro"
          segue embaixo em largura cheia, que é onde largura serve para alguma
          coisa: símbolo, rede, quantidade e valor cabem na mesma linha.
          
          Empilha abaixo de lg: em tela estreita, coluna ao lado de coluna vira
          duas colunas ruins.
        */}
        <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
          {chart && <div className="lg:col-span-7">{chart}</div>}
          <div className={chart ? "lg:col-span-5" : "lg:col-span-12"}>
            <TreasuryHealthHero
              layout={chart ? "column" : "row"}
              label={projLabel}
              total={total}
              unreadLabels={unreadLabels}
              unvalued={visibleGroups.flatMap((g) => g.report.unpriced)}
              sourceCount={walletCount}
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
          </div>
        </div>

        {/*
          O card "Money in vs out" saiu daqui: a mesma pergunta agora vive
          colada no gráfico de Saldo por Tesouro, como painel de variação —
          mesmo eixo do tempo, mesmo cursor. Dois lugares mostrando movimento
          de dinheiro obrigavam a pessoa a decidir em qual acreditar.

          O componente continua no repo (FinancialDashboard) e as views seguem
          sendo montadas: voltar é uma linha, se fizer falta.
        */}

        <Section title={t.sections.where} hint={isAll ? t.sections.whereHintAll : t.sections.whereHint}>
          <TreasuryViews groups={visibleGroups} hideSelector hideTotal />
        </Section>

        {/* Só sob a aba da SOPA. Ver `sopaOnly` acima. */}
        {sopaSlug && view === sopaSlug && sopaOnly}
        </>
      )}
    </div>
  );
}
