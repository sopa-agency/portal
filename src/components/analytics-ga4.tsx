"use client";

import { useEffect, useState } from "react";
import { PlugZap, AlertTriangle } from "lucide-react";
import type { Ga4Result, MetricWithDelta } from "@/lib/google-analytics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Delta badge — ▲ success / ▼ danger / — neutral
// invertGood: for metrics where DOWN is better (bounce rate)
// ---------------------------------------------------------------------------

function DeltaBadge({ m, invertGood }: { m: MetricWithDelta; invertGood?: boolean }) {
  const d = m.deltaPct;
  if (d === null || d === undefined) {
    return <span className="text-[10px] tabular-nums text-foreground-faint">—</span>;
  }
  if (d === 0) {
    return <span className="text-[10px] tabular-nums text-foreground-faint">→ 0%</span>;
  }
  const isUp = d > 0;
  const isGood = invertGood ? !isUp : isUp;
  const color = isGood ? "text-success" : "text-danger";
  const arrow = isUp ? "▲" : "▼";
  return (
    <span className={`text-[10px] tabular-nums ${color}`}>
      {arrow} {Math.abs(d)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5 rounded-2xl border border-border bg-surface p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
            <div className="h-2 w-14 rounded bg-border-strong" />
            <div className="mt-2 h-6 w-16 rounded bg-border-strong" />
            <div className="mt-1 h-2 w-10 rounded bg-border-strong" />
          </div>
        ))}
      </div>
      <div className="h-12 rounded-xl border border-border bg-surface-elevated" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border bg-surface-elevated p-4">
            <div className="h-2.5 w-20 rounded bg-border-strong" />
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="flex items-center justify-between gap-4">
                <div className="h-2.5 w-40 rounded bg-border-strong" />
                <div className="h-2.5 w-10 rounded bg-border-strong" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not configured / Error cards
// ---------------------------------------------------------------------------

function NotConfigured() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-surface px-5 py-5">
      <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-foreground-faint" />
      <div>
        <p className="text-sm font-medium text-foreground-muted">Google Analytics not configured</p>
        <p className="mt-1 text-xs leading-5 text-foreground-subtle">
          Set <code className="font-mono">ga4PropertyId</code> in this project&apos;s analytics config.
        </p>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-3">
      <p className="text-sm text-danger">
        Analytics unavailable{message ? `: ${message}` : "."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------

type KpiCardProps = {
  label: string;
  value: string;
  metric: MetricWithDelta;
  invertGood?: boolean;
};

function KpiCard({ label, value, metric, invertGood }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <div className="mt-0.5">
        <DeltaBadge m={metric} invertGood={invertGood} />
      </div>
    </div>
  );
}

function KpiRow({ summary, days }: { summary: Extract<Ga4Result, { ok: true }>["summary"]; days: number }) {
  const cards: KpiCardProps[] = [
    { label: `Users (${days}d)`, value: fmt(summary.activeUsers.value), metric: summary.activeUsers },
    { label: `New users (${days}d)`, value: fmt(summary.newUsers.value), metric: summary.newUsers },
    { label: `Sessions (${days}d)`, value: fmt(summary.sessions.value), metric: summary.sessions },
    { label: `Views (${days}d)`, value: fmt(summary.screenPageViews.value), metric: summary.screenPageViews },
    { label: `Engagement (${days}d)`, value: fmtPct(summary.engagementRate.value), metric: summary.engagementRate },
    { label: `Avg session (${days}d)`, value: fmtDuration(summary.averageSessionDuration.value), metric: summary.averageSessionDuration },
    { label: `Bounce rate (${days}d)`, value: fmtPct(summary.bounceRate.value), metric: summary.bounceRate, invertGood: true },
    { label: `Engaged sessions (${days}d)`, value: fmt(summary.engagedSessions.value), metric: summary.engagedSessions },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function AlertChips({ alerts }: { alerts: string[] }) {
  if (!alerts.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {alerts.map((a, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
        >
          <AlertTriangle className="h-3 w-3" />
          {a}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend sparkline
// ---------------------------------------------------------------------------

function TrendBar({ trend, days }: { trend: { date: string; users: number }[]; days: number }) {
  if (trend.length === 0) return null;
  const max = Math.max(...trend.map((d) => d.users), 1);
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
        Active users — last {days} days
      </p>
      <div className="flex h-12 items-end gap-px">
        {trend.map((d) => {
          const heightPct = Math.max((d.users / max) * 100, 2);
          return (
            <div
              key={d.date}
              title={`${d.date}: ${fmt(d.users)} users`}
              className="flex-1 rounded-sm bg-accent opacity-70 transition-opacity hover:opacity-100"
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top pages table
// ---------------------------------------------------------------------------

function TopPagesTable({ rows, days }: { rows: { path: string; views: number }[]; days: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Top pages ({days}d)</SectionHeader>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-border text-[10px] font-semibold tabular-nums text-foreground-subtle">
                {i + 1}
              </span>
              <span className="truncate text-xs text-foreground-muted" title={r.path}>
                {r.path}
              </span>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-foreground">{fmt(r.views)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source/medium table (bar chart)
// ---------------------------------------------------------------------------

function SourceMediumTable({ rows, days }: { rows: { name: string; sessions: number }[]; days: number }) {
  const max = Math.max(...rows.map((r) => r.sessions), 1);
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Acquisition — source/medium ({days}d)</SectionHeader>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 py-0.5">
            <span className="w-36 shrink-0 truncate text-xs text-foreground-muted" title={r.name}>{r.name}</span>
            <div className="flex h-2 flex-1 rounded-full bg-border">
              <div
                className="rounded-full bg-accent"
                style={{ width: `${(r.sessions / max) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-foreground">
              {fmt(r.sessions)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Devices + New vs Returning (small cards)
// ---------------------------------------------------------------------------

function DevicesTable({ rows, days }: { rows: { name: string; sessions: number }[]; days: number }) {
  const total = rows.reduce((s, r) => s + r.sessions, 0) || 1;
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Devices ({days}d)</SectionHeader>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 py-0.5">
            <span className="w-20 shrink-0 truncate text-xs text-foreground-muted capitalize">{r.name}</span>
            <div className="flex h-2 flex-1 rounded-full bg-border">
              <div
                className="rounded-full bg-accent"
                style={{ width: `${(r.sessions / total) * 100}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-foreground-muted">
              {fmt(r.sessions)} ({((r.sessions / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewVsReturningTable({ rows, days }: { rows: { name: string; users: number }[]; days: number }) {
  const total = rows.reduce((s, r) => s + r.users, 0) || 1;
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>New vs returning ({days}d)</SectionHeader>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 py-0.5">
            <span className="w-24 shrink-0 truncate text-xs text-foreground-muted capitalize">{r.name}</span>
            <div className="flex h-2 flex-1 rounded-full bg-border">
              <div
                className="rounded-full bg-accent"
                style={{ width: `${(r.users / total) * 100}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-foreground-muted">
              {fmt(r.users)} ({((r.users / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countries table
// ---------------------------------------------------------------------------

function CountriesTable({ rows, days }: { rows: { name: string; users: number }[]; days: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Top countries ({days}d)</SectionHeader>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-1">
            <span className="text-xs text-foreground-muted">{r.name}</span>
            <span className="text-xs tabular-nums text-foreground">{fmt(r.users)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live data layout
// ---------------------------------------------------------------------------

function LiveGa4({ data }: { data: Extract<Ga4Result, { ok: true }> }) {
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5">
      {data.alerts.length > 0 && <AlertChips alerts={data.alerts} />}
      <KpiRow summary={data.summary} days={data.days} />
      <TrendBar trend={data.trend} days={data.days} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopPagesTable rows={data.topPages} days={data.days} />
        <SourceMediumTable rows={data.sourceMedium} days={data.days} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DevicesTable rows={data.devices} days={data.days} />
        <NewVsReturningTable rows={data.newVsReturning} days={data.days} />
      </div>
      <CountriesTable rows={data.countries} days={data.days} />
      <p className="text-[10px] tabular-nums text-foreground-faint">
        Updated {fmtRelative(data.fetchedAt)} · cached 10 min
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported panel
// ---------------------------------------------------------------------------

export function Ga4Panel({ days }: { days: 7 | 28 | 90 }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "done"; data: Ga4Result }
    | { status: "fetch-error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    let cancelled = false;
    fetch(`/api/analytics/ga4?days=${days}`)
      .then(async (res) => {
        const json = (await res.json()) as Ga4Result;
        if (!cancelled) setState({ status: "done", data: json });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            status: "fetch-error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (state.status === "loading") return <Skeleton />;
  if (state.status === "fetch-error") return <ErrorCard message={state.message} />;

  const { data } = state;
  if (!data.ok && data.reason === "not-configured") return <NotConfigured />;
  if (!data.ok) return <ErrorCard message={"error" in data ? data.error : undefined} />;
  return <LiveGa4 data={data} />;
}
