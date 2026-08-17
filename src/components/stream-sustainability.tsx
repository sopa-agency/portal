"use client";

import { Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";
import { usd } from "@/lib/format";
import { ReadFailed } from "@/components/data-state";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

// The sustainability "ruler": is the yield covering the stream, and how much
// runway does the USDCx buffer give? Plus the guided action — harvest yield
// from Morpho into the stream buffer so the treasury never runs dry.
export function StreamSustainability({
  yieldMonthly,
  burnMonthly,
  bufferUsdcx,
  runwayDays,
  failed = false,
}: {
  yieldMonthly: number | null;
  burnMonthly: number;
  bufferUsdcx: number;
  runwayDays: number | null;
  /** Pool exists but the stream read failed → show a read-failed state, not "parado". */
  failed?: boolean;
}) {
  const t = useT().treasury.sustainability;
  if (failed) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Gauge className="h-4 w-4 text-accent" /> {t.title}
        </h2>
        <ReadFailed>{t.readFailed}</ReadFailed>
      </section>
    );
  }

  const streaming = burnMonthly > 0;
  const sustainable = yieldMonthly != null && streaming && yieldMonthly >= burnMonthly;
  const coverage = streaming && yieldMonthly != null ? yieldMonthly / burnMonthly : null;

  // Runway meter: cap the visual at 90 days; ticks at 14d (danger) / 45d (ok).
  const CAP = 90;
  const rw = runwayDays == null ? 0 : Math.min(runwayDays, CAP);
  // null = sem stream ativo → régua neutra/vazia (nunca verde cheia, que leria "∞ ok").
  const runwayColor = runwayDays == null ? "var(--border)" : runwayDays < 14 ? "var(--danger)" : runwayDays < 45 ? "var(--warning)" : "var(--success)";

  const verdict = !streaming
    ? { tone: "muted", icon: Gauge, text: t.verdictStopped }
    : sustainable
      ? { tone: "success", icon: CheckCircle2, text: t.verdictOk }
      : { tone: "danger", icon: AlertTriangle, text: t.verdictDanger };
  const Vi = verdict.icon;
  const vColor = verdict.tone === "success" ? "text-success" : verdict.tone === "danger" ? "text-danger" : "text-foreground-muted";

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Gauge className="h-4 w-4 text-accent" /> {t.title}
      </h2>

      {/* Verdict */}
      <div className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
        verdict.tone === "success" ? "border-success/30 bg-success/5" : verdict.tone === "danger" ? "border-danger/30 bg-danger/5" : "border-border bg-surface-elevated"
      }`}>
        <Vi className={`mt-0.5 h-4 w-4 shrink-0 ${vColor}`} />
        <span className="text-foreground">{verdict.text}</span>
      </div>

      {/* Yield vs burn */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-foreground-muted">{t.yield} <span className="font-semibold text-success">{yieldMonthly != null ? usd(yieldMonthly) : "—"}</span></span>
          <span className="text-foreground-muted">{t.payment} <span className="font-semibold text-foreground">{usd(burnMonthly)}</span></span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full"
            style={{ width: `${coverage == null ? 0 : Math.min(coverage, 1) * 100}%`, backgroundColor: sustainable ? "var(--success)" : "var(--warning)" }}
          />
        </div>
        <p className="mt-1 text-[11px] text-foreground-faint">
          {coverage == null ? t.noStream : coverage >= 1 ? t.covers(Math.round(coverage * 100)) : t.coversPartial(Math.round(coverage * 100))}
        </p>
      </div>

      {/* Runway meter (a régua). runwayDays == null = sem stream ativo: barra vazia
          e neutra + "—", nunca a barra verde cheia (que leria como "runway infinito"). */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-foreground-muted">{t.bufferLasts}</span>
          <span
            className={`font-semibold tabular-nums ${runwayDays == null ? "text-foreground-faint" : ""}`}
            style={runwayDays == null ? undefined : { color: runwayColor }}
          >
            {runwayDays == null ? "—" : `${Math.floor(runwayDays)}d`} {t.inBuffer(usd(bufferUsdcx))}
          </span>
        </div>
        <div className="relative h-3 rounded-full bg-border">
          {runwayDays != null && (
            <div className="h-full rounded-full transition-all" style={{ width: `${(rw / CAP) * 100}%`, backgroundColor: runwayColor }} />
          )}
          {/* threshold ticks */}
          <div className="absolute top-0 h-3 w-px bg-danger/60" style={{ left: `${(14 / CAP) * 100}%` }} title={t.days(14)} />
          <div className="absolute top-0 h-3 w-px bg-warning/60" style={{ left: `${(45 / CAP) * 100}%` }} title={t.days(45)} />
        </div>
        <div className="mt-1 flex justify-between text-[9px] text-foreground-faint">
          <span>0</span><span>14d</span><span>45d</span><span>90d+</span>
        </div>
      </div>

      <p className="text-[11px] text-foreground-faint">
        {rich(t.footer)}
      </p>
    </section>
  );
}
