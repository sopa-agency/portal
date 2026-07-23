"use client";

import { Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

// The sustainability "ruler": is the yield covering the stream, and how much
// runway does the USDCx buffer give? Plus the guided action — harvest yield
// from Morpho into the stream buffer so the treasury never runs dry.
export function StreamSustainability({
  yieldMonthly,
  burnMonthly,
  bufferUsdcx,
  runwayDays,
}: {
  yieldMonthly: number | null;
  burnMonthly: number;
  bufferUsdcx: number;
  runwayDays: number | null;
}) {
  const streaming = burnMonthly > 0;
  const sustainable = yieldMonthly != null && streaming && yieldMonthly >= burnMonthly;
  const coverage = streaming && yieldMonthly != null ? yieldMonthly / burnMonthly : null;

  // Runway meter: cap the visual at 90 days; ticks at 14d (danger) / 45d (ok).
  const CAP = 90;
  const rw = runwayDays == null ? CAP : Math.min(runwayDays, CAP);
  const runwayColor = runwayDays == null ? "var(--success)" : runwayDays < 14 ? "var(--danger)" : runwayDays < 45 ? "var(--warning)" : "var(--success)";

  const verdict = !streaming
    ? { tone: "muted", icon: Gauge, text: "Pagamento parado — ligue a torneira nos Controles pra começar a pagar." }
    : sustainable
      ? { tone: "success", icon: CheckCircle2, text: "Sustentável: o rendimento do cofre cobre o pagamento. O principal fica intacto — pra sempre." }
      : { tone: "danger", icon: AlertTriangle, text: "Atenção: o pagamento consome mais que o rendimento. Reduza a torneira ou guarde mais no cofre — senão o principal encolhe." };
  const Vi = verdict.icon;
  const vColor = verdict.tone === "success" ? "text-success" : verdict.tone === "danger" ? "text-danger" : "text-foreground-muted";

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Gauge className="h-4 w-4 text-accent" /> Isso é sustentável?
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
          <span className="text-foreground-muted">Rendimento <span className="font-semibold text-success">{yieldMonthly != null ? usd(yieldMonthly) : "—"}</span></span>
          <span className="text-foreground-muted">Pagamento <span className="font-semibold text-foreground">{usd(burnMonthly)}</span></span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full"
            style={{ width: `${coverage == null ? 0 : Math.min(coverage, 1) * 100}%`, backgroundColor: sustainable ? "var(--success)" : "var(--warning)" }}
          />
        </div>
        <p className="mt-1 text-[11px] text-foreground-faint">
          {coverage == null ? "Sem pagamento ativo." : coverage >= 1 ? `O rendimento cobre ${Math.round(coverage * 100)}% do pagamento — a sobra recompõe o principal.` : `O rendimento cobre só ${Math.round(coverage * 100)}% do pagamento. Pra ser sustentável pra sempre, a barra precisa encher.`}
        </p>
      </div>

      {/* Runway meter (a régua) */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-foreground-muted">Reserva dura</span>
          <span className="font-semibold tabular-nums" style={{ color: runwayColor }}>
            {runwayDays == null ? "∞" : `${Math.floor(runwayDays)}d`} · na reserva {usd(bufferUsdcx)}
          </span>
        </div>
        <div className="relative h-3 rounded-full bg-border">
          <div className="h-full rounded-full transition-all" style={{ width: `${(rw / CAP) * 100}%`, backgroundColor: runwayColor }} />
          {/* threshold ticks */}
          <div className="absolute top-0 h-3 w-px bg-danger/60" style={{ left: `${(14 / CAP) * 100}%` }} title="14 dias" />
          <div className="absolute top-0 h-3 w-px bg-warning/60" style={{ left: `${(45 / CAP) * 100}%` }} title="45 dias" />
        </div>
        <div className="mt-1 flex justify-between text-[9px] text-foreground-faint">
          <span>0</span><span>14d</span><span>45d</span><span>90d+</span>
        </div>
      </div>

      <p className="text-[11px] text-foreground-faint">
        Pra ajustar a vazão, colher rendimento ou ligar o piloto automático, vá em <b>Controles → Ligar o pagamento</b>.
      </p>
    </section>
  );
}
