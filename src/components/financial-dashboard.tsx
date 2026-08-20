"use client";

import { useMemo, useState } from "react";
import { Coins } from "lucide-react";
import type { FinanceMonthPoint, FinancialDashboardView } from "@/lib/financial-dashboard";
import { useLocale } from "@/components/locale-provider";

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
function Bars({ series }: { series: FinanceMonthPoint[] }) {
  const { locale, t } = useLocale();
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";
  const d = t.treasury.dashboard;
  const max = Math.max(1, ...series.flatMap((p) => [p.incomingUsd, p.outgoingUsd]));
  return (
    <div>
      {/* items-end stops the columns from stretching, so they need h-full —
          otherwise the bars' percentage heights resolve against zero. */}
      <div className="flex h-[150px] items-end gap-2.5 border-b border-border">
        {series.map((p) => (
          <div key={p.month} className="flex h-full flex-1 items-end justify-center gap-1">
            <div
              className="w-3.5 rounded-t bg-accent"
              style={{ height: `${Math.max((p.incomingUsd / max) * 100, p.incomingUsd > 0 ? 2 : 0)}%` }}
              title={d.barIn(usd(p.incomingUsd))}
            />
            <div
              className="w-3.5 rounded-t bg-border-strong"
              style={{ height: `${Math.max((p.outgoingUsd / max) * 100, p.outgoingUsd > 0 ? 2 : 0)}%` }}
              title={d.barOut(usd(p.outgoingUsd))}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2.5 px-1 pt-1.5">
        {series.map((p) => (
          <div key={p.month} className="flex-1 text-center text-[11px] text-foreground-faint">
            {monthLabel(p.month, intlLocale)}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-4 text-xs text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> {d.in.toLowerCase()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-border-strong" /> {d.out.toLowerCase()}
        </span>
      </div>
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
  const t = useLocale().t.treasury;
  const d = t.dashboard;
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
            <Bars series={visibleSeries} />
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
