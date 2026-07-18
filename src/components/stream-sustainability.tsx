"use client";

import { useState, useTransition } from "react";
import { Gauge, Loader2, ExternalLink, Sprout, AlertTriangle, CheckCircle2, Zap } from "lucide-react";
import { proposeHarvest } from "@/app/actions/staking";
import { proposeAutoWrap } from "@/app/actions/superfluid";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

// The sustainability "ruler": is the yield covering the stream, and how much
// runway does the USDCx buffer give? Plus the guided action — harvest yield
// from Morpho into the stream buffer so the treasury never runs dry.
export function StreamSustainability({
  yieldMonthly,
  burnMonthly,
  bufferUsdcx,
  runwayDays,
  canEdit,
}: {
  yieldMonthly: number | null;
  burnMonthly: number;
  bufferUsdcx: number;
  runwayDays: number | null;
  canEdit: boolean;
}) {
  const suggested = yieldMonthly && yieldMonthly > 0 ? yieldMonthly.toFixed(2) : "";
  const [amount, setAmount] = useState(suggested);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: true; url: string } | { ok: false; error: string } | null>(null);
  const [allowance, setAllowance] = useState("500");
  const [awPending, startAw] = useTransition();
  const [awRes, setAwRes] = useState<{ ok: true; url: string } | { ok: false; error: string } | null>(null);

  const streaming = burnMonthly > 0;
  const sustainable = yieldMonthly != null && streaming && yieldMonthly >= burnMonthly;
  const coverage = streaming && yieldMonthly != null ? yieldMonthly / burnMonthly : null;

  // Runway meter: cap the visual at 90 days; ticks at 14d (danger) / 45d (ok).
  const CAP = 90;
  const rw = runwayDays == null ? CAP : Math.min(runwayDays, CAP);
  const runwayColor = runwayDays == null ? "var(--success)" : runwayDays < 14 ? "var(--danger)" : runwayDays < 45 ? "var(--warning)" : "var(--success)";

  const harvest = () =>
    start(async () => {
      setRes(null);
      setRes(await proposeHarvest(amount));
    });

  const enableAutoWrap = () =>
    startAw(async () => {
      setAwRes(null);
      setAwRes(await proposeAutoWrap(allowance));
    });

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

      {/* Guided actions */}
      {canEdit && (
        <>
        <div className="border-t border-border pt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Sprout className="h-3.5 w-3.5 text-success" /> Colher rendimento → reserva
          </div>
          <p className="mb-2 text-[11px] text-foreground-subtle">
            Colher rendimento reforça a reserva sem tocar no principal — é o que mantém o pagamento de pé.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="USDC"
              className="w-28 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={harvest}
              disabled={pending || !amount}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sprout className="h-3.5 w-3.5" />}
              Colher rendimento
            </button>
            {suggested && (
              <span className="text-[11px] text-foreground-faint">sugerido: {usd(Number(suggested))} (≈ 1 mês de yield)</span>
            )}
          </div>
          {res && !res.ok && <p className="mt-2 text-[11px] text-danger">{res.error}</p>}
          {res && res.ok && (
            <p className="mt-2 text-[11px] text-foreground-muted">
              Proposta na fila.{" "}
              <a href={res.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Abrir no Safe <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
        </div>

        {/* Automatic: Auto-Wrap keeps the buffer topped up without clicking */}
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Zap className="h-3.5 w-3.5 text-accent" /> Ligar piloto automático
          </div>
          <p className="mb-2 text-[11px] text-foreground-subtle">
            O piloto automático repõe a reserva sozinho quando ela baixa (repõe até ~7 dias, dispara com ~2) — o pagamento nunca para. Você aprova um limite de gasto.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              inputMode="decimal"
              placeholder="limite USDC"
              className="w-32 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={enableAutoWrap}
              disabled={awPending || !allowance}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {awPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Ligar piloto automático
            </button>
            <span className="text-[11px] text-foreground-faint">limite = teto que o piloto pode usar</span>
          </div>
          {awRes && !awRes.ok && <p className="mt-2 text-[11px] text-danger">{awRes.error}</p>}
          {awRes && awRes.ok && (
            <p className="mt-2 text-[11px] text-foreground-muted">
              Proposta na fila.{" "}
              <a href={awRes.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Abrir no Safe <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
        </div>
        </>
      )}
    </section>
  );
}
