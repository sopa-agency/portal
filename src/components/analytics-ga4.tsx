"use client";

import { useEffect, useState } from "react";
import { PlugZap, AlertTriangle } from "lucide-react";
import type { Ga4Result, MetricWithDelta } from "@/lib/google-analytics";
import { useT } from "@/components/locale-provider";
import { useLocale } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { BarList } from "@/components/charts/bar-list";
import { ShareBar } from "@/components/charts/share-bar";

type T = Dictionary["analytics"];

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

function fmtRelative(iso: string, t: T["state"]): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return t.minutesAgo(mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t.hoursAgo(hrs);
    return t.daysAgo(Math.floor(hrs / 24));
  } catch {
    return "";
  }
}

/** "7 ago" / "Aug 7" for the x axis — short, no year.
 *
 *  Two formats reach this: GA4's `date` dimension gives yyyymmdd, Search
 *  Console's gives yyyy-mm-dd. Both are built from their parts rather than
 *  handed to `new Date(string)`, which reads them as UTC midnight and lands on
 *  the day before for anyone west of Greenwich. */
export function shortDate(iso: string, locale: string): string {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", {
    day: "numeric",
    month: "short",
  });
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

function NotConfigured({ t }: { t: T["state"] }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-surface px-5 py-5">
      <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-foreground-faint" />
      <div>
        <p className="text-sm font-medium text-foreground-muted">{t.notConfiguredTitle}</p>
        <p className="mt-1 text-xs leading-5 text-foreground-subtle">{t.notConfiguredBody}</p>
      </div>
    </div>
  );
}

function ErrorCard({ message, t }: { message?: string; t: T["state"] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-3">
      <p className="text-sm text-danger">
        {t.unavailable}
        {message ? `: ${message}` : "."}
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
      {/* Proportional figures: tabular-nums gives every digit a zero's width,
          which reads loose at display size. Reserved for aligned columns. */}
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <div className="mt-0.5">
        <DeltaBadge m={metric} invertGood={invertGood} />
      </div>
    </div>
  );
}

function KpiRow({ summary, t }: { summary: Extract<Ga4Result, { ok: true }>["summary"]; t: T }) {
  // The period is stated once, by the range selector above — it used to be
  // repeated inside all eight labels ("Users (28d)", "Sessions (28d)", …).
  const cards: KpiCardProps[] = [
    { label: t.kpi.users, value: fmt(summary.activeUsers.value), metric: summary.activeUsers },
    { label: t.kpi.newUsers, value: fmt(summary.newUsers.value), metric: summary.newUsers },
    { label: t.kpi.sessions, value: fmt(summary.sessions.value), metric: summary.sessions },
    { label: t.kpi.views, value: fmt(summary.screenPageViews.value), metric: summary.screenPageViews },
    { label: t.kpi.engagement, value: fmtPct(summary.engagementRate.value), metric: summary.engagementRate },
    { label: t.kpi.avgSession, value: fmtDuration(summary.averageSessionDuration.value), metric: summary.averageSessionDuration },
    { label: t.kpi.bounceRate, value: fmtPct(summary.bounceRate.value), metric: summary.bounceRate, invertGood: true },
    { label: t.kpi.engagedSessions, value: fmt(summary.engagedSessions.value), metric: summary.engagedSessions },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" title={t.kpi.vsPrevious}>
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
// Card — one framed block per question
// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>{title}</SectionHeader>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live data layout
// ---------------------------------------------------------------------------

function LiveGa4({ data, t, locale }: { data: Extract<Ga4Result, { ok: true }>; t: T; locale: string }) {
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5">
      {data.alerts.length > 0 && <AlertChips alerts={data.alerts} />}

      <KpiRow summary={data.summary} t={t} />

      {/* Trend over time → a line, with the crosshair reading the day. */}
      <div className="rounded-xl border border-border bg-surface-elevated p-4">
        <SectionHeader>{t.sections.trend(data.days)}</SectionHeader>
        <TimeSeriesChart
          labels={data.trend.map((d) => shortDate(d.date, locale))}
          series={[{ color: "var(--viz-1)", label: t.kpi.users, points: data.trend.map((d) => d.users) }]}
          formatValue={fmt}
          emptyLabel={t.state.empty}
          tableLabel={t.state.tableView}
          dateLabel={t.state.date}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.sections.topPages}>
          <BarList
            rows={data.topPages.map((r) => ({ name: r.path, value: r.views, hint: r.path }))}
            formatValue={fmt}
            emptyLabel={t.state.empty}
          />
        </Card>
        <Card title={t.sections.sources}>
          <BarList
            rows={data.sourceMedium.map((r) => ({ name: r.name, value: r.sessions }))}
            formatValue={fmt}
            emptyLabel={t.state.empty}
          />
        </Card>
      </div>

      {/* Part-to-whole → one stacked bar each, not N separate tracks. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.sections.devices}>
          <ShareBar
            slices={data.devices.map((r) => ({ name: r.name, value: r.sessions }))}
            formatValue={fmt}
            emptyLabel={t.state.empty}
            otherLabel={t.state.other}
          />
        </Card>
        <Card title={t.sections.newVsReturning}>
          <ShareBar
            slices={data.newVsReturning.map((r) => ({ name: r.name, value: r.users }))}
            formatValue={fmt}
            emptyLabel={t.state.empty}
            otherLabel={t.state.other}
          />
        </Card>
      </div>

      <Card title={t.sections.countries}>
        <BarList
          rows={data.countries.map((r) => ({ name: r.name, value: r.users }))}
          formatValue={fmt}
          emptyLabel={t.state.empty}
        />
      </Card>

      <p className="text-[10px] text-foreground-faint">
        {t.state.updated(fmtRelative(data.fetchedAt, t.state))}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported panel
// ---------------------------------------------------------------------------

export function Ga4Panel({ days }: { days: 7 | 28 | 90 }) {
  const t = useT().analytics;
  const { locale } = useLocale();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "done"; data: Ga4Result }
    | { status: "fetch-error"; message: string }
  >({ status: "loading" });
  // Changing the period must not flash a skeleton: the previous render holds
  // its place at reduced opacity, so the layout never jumps and the click
  // reads as "this is updating" rather than "the page reloaded".
  const [refetching, setRefetching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRefetching(true);
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
      })
      .finally(() => {
        if (!cancelled) setRefetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Only the very first load has nothing to hold on to.
  if (state.status === "loading") return <Skeleton />;
  if (state.status === "fetch-error") return <ErrorCard message={state.message} t={t.state} />;

  const { data } = state;
  if (!data.ok && data.reason === "not-configured") return <NotConfigured t={t.state} />;
  if (!data.ok) return <ErrorCard message={"error" in data ? data.error : undefined} t={t.state} />;
  return (
    <div
      aria-busy={refetching}
      className={`transition-opacity duration-200 ${refetching ? "opacity-50" : "opacity-100"}`}
    >
      <LiveGa4 data={data} t={t} locale={locale} />
    </div>
  );
}
