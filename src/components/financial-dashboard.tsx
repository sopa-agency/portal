"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Briefcase, CalendarRange, Coins, Wallet } from "lucide-react";
import type { FinanceMonthPoint, FinancialDashboardView } from "@/lib/financial-dashboard";

const usd = (n: number, d = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : d });

const monthLabel = (month: string) => {
  const [year, mm] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mm - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
};

const netTone = (n: number) => (n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-danger");
const ranges = [12, 6, 3, 1] as const;

function sum(series: FinanceMonthPoint[], key: keyof FinanceMonthPoint) {
  return series.reduce((total, point) => total + (typeof point[key] === "number" ? (point[key] as number) : 0), 0);
}

function StatCard({
  label,
  value,
  hint,
  tone = "text-foreground",
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle">
        <span className="text-foreground-faint">{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <p className="mt-1 text-xs text-foreground-faint">{hint}</p>
    </div>
  );
}

function FlowChart({ series }: { series: FinanceMonthPoint[] }) {
  if (series.length === 0) return null;
  const width = 720;
  const height = 260;
  const left = 40;
  const right = 16;
  const top = 12;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const maxValue = Math.max(1, ...series.flatMap((point) => [point.incomingUsd, point.outgoingUsd]));
  const slot = innerW / series.length;
  const barW = Math.min(18, Math.max(8, slot * 0.26));
  const netPoints = series
    .map((point, idx) => {
      const net = point.incomingUsd - point.outgoingUsd;
      const x = left + slot * idx + slot / 2;
      const y = top + innerH - (Math.max(net, 0) / maxValue) * innerH;
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rounded-3xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Entrada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-400" />
          Saída
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          Líquido
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="block h-[260px] w-full" aria-label="Gráfico de entrada e saída">
        {[0, 0.5, 1].map((step) => {
          const y = top + innerH - innerH * step;
          return (
            <g key={step}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="currentColor" opacity="0.12" />
              <text x={left - 8} y={y + 4} textAnchor="end" className="fill-foreground-faint text-[10px]">
                {usd(maxValue * step, 0)}
              </text>
            </g>
          );
        })}

        {series.map((point, idx) => {
          const x = left + slot * idx + slot / 2;
          const inH = (point.incomingUsd / maxValue) * innerH;
          const outH = (point.outgoingUsd / maxValue) * innerH;
          const incomingY = top + innerH - inH;
          const outgoingY = top + innerH - outH;
          return (
            <g key={point.month}>
              <rect x={x - barW - 2} y={incomingY} width={barW} height={Math.max(inH, 2)} rx="5" fill="#10b981" opacity="0.95">
                <title>{`${point.month}: entrou ${usd(point.incomingUsd, 0)}`}</title>
              </rect>
              <rect x={x + 2} y={outgoingY} width={barW} height={Math.max(outH, 2)} rx="5" fill="#fb923c" opacity="0.95">
                <title>{`${point.month}: saiu ${usd(point.outgoingUsd, 0)}`}</title>
              </rect>
              <text x={x} y={height - 10} textAnchor="middle" className="fill-foreground-faint text-[10px]">
                {monthLabel(point.month)}
              </text>
            </g>
          );
        })}

        {series.length > 1 && <path d={netPoints} fill="none" stroke="var(--color-accent, #a3e635)" strokeWidth="2.5" strokeLinecap="round" />}
      </svg>
    </div>
  );
}

export function FinancialDashboard({
  views,
  selectedView,
}: {
  views: FinancialDashboardView[];
  selectedView: string;
}) {
  const [range, setRange] = useState<(typeof ranges)[number]>(6);
  const view = views.find((item) => item.slug === selectedView) ?? views[0];
  const visibleSeries = useMemo(() => view.series.slice(-range), [range, view.series]);

  const incomingUsd = sum(visibleSeries, "incomingUsd");
  const outgoingUsd = sum(visibleSeries, "outgoingUsd");
  const jobsUsd = sum(visibleSeries, "jobsUsd");
  const onchainIncomingUsd = sum(visibleSeries, "onchainIncomingUsd");
  const fixedCostsUsd = sum(visibleSeries, "fixedCostsUsd");
  const netUsd = incomingUsd - outgoingUsd;
  const latest = visibleSeries[visibleSeries.length - 1];
  const jobsShare = incomingUsd > 0 ? (jobsUsd / incomingUsd) * 100 : 0;
  const onchainShare = incomingUsd > 0 ? (onchainIncomingUsd / incomingUsd) * 100 : 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Entrada vs saída</h2>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            O que entrou e o que saiu, mês a mês — receita on-chain rastreada, jobs da SOPA e custos fixos.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ranges.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                range === value
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {value}m
            </button>
          ))}
        </div>
      </div>

      <FlowChart series={visibleSeries} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Entrada"
          value={usd(incomingUsd, 0)}
          hint={`total em ${range} ${range === 1 ? "mês" : "meses"}`}
          tone="text-emerald-600 dark:text-emerald-400"
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <StatCard
          label="Saída"
          value={usd(outgoingUsd, 0)}
          hint="custos operacionais rastreados aqui"
          tone="text-orange-500"
          icon={<ArrowDownRight className="h-4 w-4" />}
        />
        <StatCard
          label="Líquido no período"
          value={usd(netUsd, 0)}
          hint={latest ? `${monthLabel(latest.month)}: ${usd(latest.incomingUsd - latest.outgoingUsd, 0)}` : "sem dados"}
          tone={netTone(netUsd)}
          icon={<CalendarRange className="h-4 w-4" />}
        />
        <StatCard
          label="Runway"
          value={view.runwayMonths == null ? "∞" : `${view.runwayMonths >= 10 ? Math.round(view.runwayMonths) : view.runwayMonths.toFixed(1)} meses`}
          hint={`${usd(view.treasuryUsd, 0)} no tesouro · ${usd(view.burnUsd, 0)}/mês de gasto`}
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle">
            <Coins className="h-4 w-4 text-foreground-faint" />
            De onde vem a receita
          </div>
          <p className="mt-1 text-[11px] text-foreground-faint">Jobs = trabalhos da agência. On-chain = fatia dos leilões e swaps das marcas.</p>
          <div className="mt-3 space-y-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground-muted">Marcas (on-chain)</span>
                <span className="font-semibold tabular-nums text-foreground">{usd(onchainIncomingUsd, 0)} · {Math.round(onchainShare)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(onchainShare, onchainIncomingUsd > 0 ? 4 : 0)}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-foreground-muted">Agência (jobs)</span>
                <span className="font-semibold tabular-nums text-foreground">{usd(jobsUsd, 0)} · {Math.round(jobsShare)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(jobsShare, jobsUsd > 0 ? 4 : 0)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <StatCard
          label="Saldo on-chain"
          value={usd(view.onchainBalanceUsd, 0)}
          hint={`${usd(view.onchainRealizedTotalUsd, 0)} de receita realizada até agora`}
          icon={<Coins className="h-4 w-4" />}
        />

        <StatCard
          label="A receber"
          value={usd(view.pendingJobsUsd, 0)}
          hint={`${usd(fixedCostsUsd, 0)} de custos fixos no período`}
          icon={<Briefcase className="h-4 w-4" />}
        />
      </div>
    </section>
  );
}
