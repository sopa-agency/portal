"use client";

import { useMemo, useState } from "react";
import { Coins } from "lucide-react";
import type { FinanceMonthPoint, FinancialDashboardView } from "@/lib/financial-dashboard";
import { useLocale } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";

// "Entrada vs saída" — the operating view, laid out per the Claude Design:
// one card with the paired bar chart on the left and the period totals on the
// right, then the revenue mix and the standing balances below.

const usd = (n: number, d = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : d });

const monthLabel = (month: string, locale: string) => {
  const [year, mm] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mm - 1, 1)).toLocaleDateString(locale, { month: "short", timeZone: "UTC" }).replace(".", "");
};

const ranges = [12, 6, 3, 1] as const;

function sum(series: FinanceMonthPoint[], key: keyof FinanceMonthPoint) {
  return series.reduce((total, point) => total + (typeof point[key] === "number" ? (point[key] as number) : 0), 0);
}

/** Paired bars per month: entrada (accent) vs saída (muted). */
/**
 * Fluxo e saldo, um bloco só — mesmo eixo X, escalas SEPARADAS.
 *
 * Os dois pertencem juntos: o fluxo mensal é o que explica o saldo. Mas são
 * medidas de naturezas diferentes — saldo é ESTOQUE (um valor num instante),
 * fluxo é VAZÃO (um valor por período) — e as grandezas nem se parecem: um
 * tesouro de $30k ao lado de $2k/mês de movimento.
 *
 * Por isso eles compartilham o eixo do TEMPO e nunca o do valor. Empilhar as
 * duas escalas num plot só exigiria dois eixos Y, e o alinhamento entre eles
 * seria arbitrário: o gráfico passaria a AFIRMAR uma correlação que ninguém
 * mediu. É a mesma classe de mentira que esta página passou a noite tirando da
 * tela, só que vinda da forma do gráfico em vez de um `catch`.
 *
 * O alinhamento é por construção: os dois plots usam a MESMA grade de N colunas
 * iguais e sem gap, então a coluna de julho está no mesmo x nos dois. Um layout
 * com `gap` deslocaria os centros e o alinhamento viraria coincidência.
 */
function FlowAndBalance({
  series,
  balance,
  d,
  intlLocale,
}: {
  series: FinanceMonthPoint[];
  balance: (number | null)[];
  d: Dictionary["treasury"]["dashboard"];
  intlLocale: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = series.length;
  const cols = { display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` } as const;

  const flowMax = Math.max(1, ...series.flatMap((p) => [p.incomingUsd, p.outgoingUsd]));
  const known = balance.filter((v): v is number => v != null);
  const balMax = known.length ? Math.max(...known) : 0;
  const balMin = known.length ? Math.min(...known) : 0;
  // Piso no zero quando tudo é positivo: uma linha de saldo que não parte do
  // zero exagera a variação, que é a outra forma clássica de o eixo mentir.
  const lo = Math.min(0, balMin);
  const span = Math.max(1, balMax - lo);
  const yOf = (v: number) => 100 - ((v - lo) / span) * 100;

  // Segmentos: mês sem foto QUEBRA a linha em vez de interpolar. Ligar os dois
  // lados de um buraco desenharia uma trajetória que ninguém observou.
  const segments: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  balance.forEach((v, i) => {
    if (v == null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push({ i, v });
  });
  if (run.length) segments.push(run);
  const gaps = balance.filter((v) => v == null).length;

  return (
    <div onPointerLeave={() => setHover(null)}>
      {known.length > 0 && (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">
              {d.balanceTitle}
            </span>
            <span className="text-[10px] tabular-nums text-foreground-faint">{usd(balMax)}</span>
          </div>
          <div className="relative h-[80px]">
            <svg
              viewBox={`0 0 ${n} 100`}
              preserveAspectRatio="none"
              className="h-full w-full overflow-visible"
              aria-hidden
            >
              {segments.map((seg, k) => (
                <polyline
                  key={k}
                  points={seg.map((p) => `${p.i + 0.5},${yOf(p.v)}`).join(" ")}
                  fill="none"
                  stroke="var(--foreground)"
                  strokeOpacity={0.7}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {hover != null && balance[hover] != null && (
                <circle
                  cx={hover + 0.5}
                  cy={yOf(balance[hover]!)}
                  r={4}
                  fill="var(--surface)"
                  stroke="var(--foreground)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
          {gaps > 0 && <p className="mb-1 text-[10px] text-foreground-faint">{d.balanceGaps(gaps)}</p>}
        </>
      )}

      <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">{d.flowTitle}</span>
      {/* items-end stops the columns from stretching, so they need h-full —
          otherwise the bars' percentage heights resolve against zero. */}
      <div className="h-[150px] border-b border-border" style={cols}>
        {series.map((p, i) => (
          <div
            key={p.month}
            onPointerEnter={() => setHover(i)}
            className={`flex h-full items-end justify-center gap-1 px-1 ${hover === i ? "bg-surface-elevated" : ""}`}
          >
            <div
              className="w-3.5 rounded-t bg-accent"
              style={{ height: `${Math.max((p.incomingUsd / flowMax) * 100, p.incomingUsd > 0 ? 2 : 0)}%` }}
            />
            <div
              className="w-3.5 rounded-t bg-border-strong"
              style={{ height: `${Math.max((p.outgoingUsd / flowMax) * 100, p.outgoingUsd > 0 ? 2 : 0)}%` }}
            />
          </div>
        ))}
      </div>

      <div className="pt-1.5" style={cols}>
        {series.map((p) => (
          <div key={p.month} className="text-center text-[11px] text-foreground-faint">
            {monthLabel(p.month, intlLocale)}
          </div>
        ))}
      </div>

      {/* Um tooltip só para a coluna inteira: as três medidas do mesmo mês. */}
      <div className="mt-2 min-h-[2.25rem] rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-[11px]">
        {hover == null ? (
          <span className="text-foreground-faint">{d.hoverHint}</span>
        ) : (
          <span className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="font-semibold text-foreground">{monthLabel(series[hover].month, intlLocale)}</span>
            <span className="text-foreground-muted">
              {d.balanceTitle}{" "}
              <span className="font-semibold text-foreground">
                {balance[hover] == null ? d.balanceMissing : usd(balance[hover]!)}
              </span>
            </span>
            <span className="text-foreground-muted">
              {d.in} <span className="font-semibold text-success">{usd(series[hover].incomingUsd)}</span>
            </span>
            <span className="text-foreground-muted">
              {d.out} <span className="font-semibold text-foreground">{usd(series[hover].outgoingUsd)}</span>
            </span>
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-4 text-xs text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> {d.in.toLowerCase()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-border-strong" /> {d.out.toLowerCase()}
        </span>
        {known.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full bg-foreground/70" /> {d.balanceLegend}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-foreground-faint">{d.scalesNote}</p>
    </div>
  );
}

function Box({ label, value, tone = "text-foreground", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-elevated px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-foreground-faint">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <p className="mt-0.5 text-[11px] text-foreground-faint">{sub}</p>}
    </div>
  );
}

export function FinancialDashboard({ views, selectedView }: { views: FinancialDashboardView[]; selectedView: string }) {
  const { locale, t: dict } = useLocale();
  const t = dict.treasury;
  const d = t.dashboard;
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";
  const [range, setRange] = useState<(typeof ranges)[number]>(6);
  const view = views.find((item) => item.slug === selectedView) ?? views[0];
  const visibleSeries = useMemo(() => view.series.slice(-range), [range, view.series]);

  const incomingUsd = sum(visibleSeries, "incomingUsd");
  const outgoingUsd = sum(visibleSeries, "outgoingUsd");
  const jobsUsd = sum(visibleSeries, "jobsUsd");
  const onchainIncomingUsd = sum(visibleSeries, "onchainIncomingUsd");
  const netUsd = incomingUsd - outgoingUsd;
  const jobsShare = incomingUsd > 0 ? (jobsUsd / incomingUsd) * 100 : 0;
  const onchainShare = incomingUsd > 0 ? (onchainIncomingUsd / incomingUsd) * 100 : 0;
  const periodLabel = d.months(range);
  const netPhrase =
    incomingUsd === 0 && outgoingUsd === 0
      ? d.noMovement
      : netUsd >= 0
        ? d.netPositive(periodLabel)
        : d.netNegative(periodLabel);

  return (
    <div className="space-y-4">
      {/* Chart + period totals, one card */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-base font-semibold tracking-tight text-foreground">{t.sections.inOut}</h2>
          <div className="flex gap-1 rounded-full bg-surface-elevated p-1">
            {ranges.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRange(value)}
                aria-pressed={range === value}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  range === value ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {value}m
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-6">
          <div className="min-w-[300px] flex-[2]">
            <FlowAndBalance
              series={visibleSeries}
              balance={view.balanceByMonth.slice(-range)}
              d={d}
              intlLocale={intlLocale}
            />
          </div>
          <div className="grid min-w-[220px] flex-1 grid-cols-2 gap-2.5 self-start">
            <Box label={d.in} value={usd(incomingUsd)} tone="text-success" />
            <Box label={d.out} value={usd(outgoingUsd)} tone="text-foreground" />
            <div className="col-span-2">
              <Box
                label={d.net}
                value={usd(netUsd)}
                tone={netUsd >= 0 ? "text-success" : "text-danger"}
                sub={netPhrase}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Revenue mix + standing numbers */}
      <div className="grid gap-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle">
            <Coins className="h-4 w-4 text-foreground-faint" /> {d.mixTitle}
          </div>
          <p className="mt-1 text-[11px] text-foreground-faint">
            {d.mixHint}
          </p>
          <div className="mt-3 space-y-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground-muted">{d.brands}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {usd(onchainIncomingUsd)} · {Math.round(onchainShare)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(onchainShare, onchainIncomingUsd > 0 ? 4 : 0)}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground-muted">{d.agency}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {usd(jobsUsd)} · {Math.round(jobsShare)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(jobsShare, jobsUsd > 0 ? 4 : 0)}%` }} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
