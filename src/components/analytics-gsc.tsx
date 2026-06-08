"use client";

import { useEffect, useState } from "react";
import { PlugZap, Zap } from "lucide-react";
import type { GscResult, MetricWithDelta } from "@/lib/google-analytics";

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

function fmtPos(n: number): string {
  return n.toFixed(1);
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

function shortPage(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || url;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Delta badge — ▲ success / ▼ danger / — neutral
// invertGood: for metrics where DOWN is better (avg position)
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <p className="text-sm font-medium text-foreground-muted">Search Console not configured</p>
        <p className="mt-1 text-xs leading-5 text-foreground-subtle">
          Set <code className="font-mono">gscSiteUrl</code> in this project&apos;s analytics config.
        </p>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-3">
      <p className="text-sm text-danger">
        Search Console unavailable{message ? `: ${message}` : "."}
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

function KpiRow({ totals, days }: { totals: Extract<GscResult, { ok: true }>["totals"]; days: number }) {
  const cards: KpiCardProps[] = [
    { label: `Clicks (${days}d)`, value: fmt(totals.clicks.value), metric: totals.clicks },
    { label: `Impressions (${days}d)`, value: fmt(totals.impressions.value), metric: totals.impressions },
    { label: `CTR (${days}d)`, value: fmtPct(totals.ctr.value), metric: totals.ctr },
    { label: `Avg position (${days}d)`, value: fmtPos(totals.position.value), metric: totals.position, invertGood: true },
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
// Trend sparkline
// ---------------------------------------------------------------------------

function TrendBar({ trend, days }: { trend: { date: string; clicks: number; impressions: number }[]; days: number }) {
  if (trend.length === 0) return null;
  const max = Math.max(...trend.map((d) => d.clicks), 1);
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
        Clicks — last {days} days
      </p>
      <div className="flex h-12 items-end gap-px">
        {trend.map((d) => {
          const heightPct = Math.max((d.clicks / max) * 100, 2);
          return (
            <div
              key={d.date}
              title={`${d.date}: ${fmt(d.clicks)} clicks / ${fmt(d.impressions)} impr.`}
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
// Quick wins table
// ---------------------------------------------------------------------------

function QuickWinsTable({ rows }: { rows: Extract<GscResult, { ok: true }>["quickWins"] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-accent" />
        <SectionHeader>Quick wins — optimize title/meta</SectionHeader>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-1.5 text-left font-medium text-foreground-subtle">Query</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Impr.</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Pos.</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">CTR</th>
              <th className="pb-1.5 pl-3 text-left font-medium text-foreground-subtle">Hint</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="max-w-[10rem] truncate py-1.5 text-foreground-muted" title={r.query}>{r.query}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground">{fmt(r.impressions)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground">{fmtPos(r.position)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground-muted">{fmtPct(r.ctr)}</td>
                <td className="py-1.5 pl-3 text-foreground-faint">
                  {r.position <= 10 ? "Title/meta tweak" : "Build links + content"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branded vs non-branded
// ---------------------------------------------------------------------------

function BrandedSplit({ branded }: { branded: Extract<GscResult, { ok: true }>["branded"] }) {
  const { branded: b, nonBranded: nb } = branded;
  const totalClicks = b.clicks + nb.clicks;
  const totalImpr = b.impressions + nb.impressions;
  if (totalClicks === 0 && totalImpr === 0) return null;

  const brandedClickPct = totalClicks > 0 ? ((b.clicks / totalClicks) * 100).toFixed(0) : "—";
  const nonBrandedClickPct = totalClicks > 0 ? ((nb.clicks / totalClicks) * 100).toFixed(0) : "—";

  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Branded vs non-branded</SectionHeader>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-foreground-faint uppercase tracking-[0.15em]">Branded</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{fmt(b.clicks)} clicks</p>
          <p className="text-xs tabular-nums text-foreground-muted">{fmt(b.impressions)} impr. · {brandedClickPct}%</p>
        </div>
        <div>
          <p className="text-[10px] text-foreground-faint uppercase tracking-[0.15em]">Non-branded</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{fmt(nb.clicks)} clicks</p>
          <p className="text-xs tabular-nums text-foreground-muted">{fmt(nb.impressions)} impr. · {nonBrandedClickPct}%</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gainers / Losers
// ---------------------------------------------------------------------------

function GainersLosers({
  gainers,
  losers,
}: {
  gainers: Extract<GscResult, { ok: true }>["gainers"];
  losers: Extract<GscResult, { ok: true }>["losers"];
}) {
  if (!gainers.length && !losers.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {gainers.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-elevated p-4">
          <SectionHeader>Top gainers vs prev period</SectionHeader>
          <ul className="space-y-1">
            {gainers.map((g, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-0.5">
                <span className="truncate text-xs text-foreground-muted" title={g.query}>{g.query}</span>
                <span className="shrink-0 text-xs tabular-nums text-success">+{g.delta}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {losers.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-elevated p-4">
          <SectionHeader>Top losers vs prev period</SectionHeader>
          <ul className="space-y-1">
            {losers.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-0.5">
                <span className="truncate text-xs text-foreground-muted" title={l.query}>{l.query}</span>
                <span className="shrink-0 text-xs tabular-nums text-danger">{l.delta}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top queries table
// ---------------------------------------------------------------------------

function QueriesTable({ rows }: { rows: Extract<GscResult, { ok: true }>["topQueries"] }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Top queries</SectionHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-1.5 text-left font-medium text-foreground-subtle">Query</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Clicks</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Impr.</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">CTR</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="max-w-[12rem] truncate py-1.5 text-foreground-muted" title={r.query}>{r.query}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground">{fmt(r.clicks)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground-muted">{fmt(r.impressions)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground-muted">{fmtPct(r.ctr)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground-muted">{fmtPos(r.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top pages table (with low-CTR flag)
// ---------------------------------------------------------------------------

function PagesTable({ rows }: { rows: Extract<GscResult, { ok: true }>["topPages"] }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <SectionHeader>Top pages</SectionHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-1.5 text-left font-medium text-foreground-subtle">Page</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Clicks</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">Impr.</th>
              <th className="pb-1.5 pl-3 text-right font-medium tabular-nums text-foreground-subtle">CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="max-w-[14rem] py-1.5 text-foreground-muted" title={r.page}>
                  <div className="flex items-center gap-1.5">
                    {r.lowCtr && (
                      <span
                        title="Low CTR — high impressions, low click-through. Consider improving title/meta."
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                      />
                    )}
                    <span className="truncate">{shortPage(r.page)}</span>
                  </div>
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground">{fmt(r.clicks)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground-muted">{fmt(r.impressions)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-foreground-muted">{fmtPct(r.ctr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live data layout
// ---------------------------------------------------------------------------

function LiveGsc({ data }: { data: Extract<GscResult, { ok: true }> }) {
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5">
      <KpiRow totals={data.totals} days={data.days} />
      <TrendBar trend={data.trend} days={data.days} />
      {data.quickWins.length > 0 && <QuickWinsTable rows={data.quickWins} />}
      <BrandedSplit branded={data.branded} />
      <GainersLosers gainers={data.gainers} losers={data.losers} />
      <div className="grid gap-4 lg:grid-cols-2">
        <QueriesTable rows={data.topQueries} />
        <PagesTable rows={data.topPages} />
      </div>
      <p className="text-[10px] tabular-nums text-foreground-faint">
        Updated {fmtRelative(data.fetchedAt)} · cached 10 min · GSC data lags ~3 days
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported panel
// ---------------------------------------------------------------------------

export function GscPanel({ days }: { days: 7 | 28 | 90 }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "done"; data: GscResult }
    | { status: "fetch-error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    let cancelled = false;
    fetch(`/api/analytics/gsc?days=${days}`)
      .then(async (res) => {
        const json = (await res.json()) as GscResult;
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
  return <LiveGsc data={data} />;
}
