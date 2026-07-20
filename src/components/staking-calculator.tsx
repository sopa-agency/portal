"use client";

import { useMemo, useState } from "react";
import { Calculator, RotateCcw } from "lucide-react";

// Staking calculator for the financial plan. Two questions the team actually
// asks, answered from live defaults rather than a blank form:
//   1. If we stake X at Y%, what does it become — and what does it pay monthly?
//   2. How much principal do we need for the yield alone to cover a bill forever?
//
// It's a projection, not a promise: APY floats, so the copy says so.

type Lang = "pt" | "en";

const T = {
  pt: {
    title: "Calculadora de staking",
    lead: "Projeção a partir dos números de agora. Mexa nos campos pra testar cenários — nada aqui move dinheiro.",
    principal: "Quanto está stakado",
    monthly: "Aporte por mês",
    apy: "Rendimento ao ano (APY)",
    years: "Daqui a quantos anos",
    live: "valor atual",
    resultH: "O que vira",
    future: "Valor no fim",
    contributed: "Total aportado",
    earned: "Só de rendimento",
    perMonth: "Rende por mês",
    perMonthNow: "hoje, sem aportar nada",
    projH: "Ano a ano",
    perpH: "Pra viver de renda",
    perpLead: "Quanto precisa ficar parado rendendo pra que só o juro pague uma conta, sem nunca tocar no principal:",
    perpTarget: "Conta mensal",
    perpNeed: "Precisa ter stakado",
    perpHave: "Já tem",
    perpGap: "Faltam",
    perpDone: "Já dá — o rendimento cobre essa conta sozinho.",
    presetCosts: "custos fixos da SOPA",
    presetStream: "o stream atual",
    reset: "Voltar aos valores de agora",
    caveat:
      "O APY não é fixo: ele flutua com a demanda do mercado. Trate como estimativa, não como garantia — e lembre que o rendimento é composto, então aportar cedo vale mais que aportar muito.",
    yr: "ano",
    yrs: "anos",
  },
  en: {
    title: "Staking calculator",
    lead: "Projected from today's live numbers. Change the fields to test scenarios — nothing here moves money.",
    principal: "Amount staked",
    monthly: "Monthly top-up",
    apy: "Yearly yield (APY)",
    years: "Years from now",
    live: "current value",
    resultH: "What it becomes",
    future: "Final value",
    contributed: "Total put in",
    earned: "Yield alone",
    perMonth: "Earns per month",
    perMonthNow: "today, adding nothing",
    projH: "Year by year",
    perpH: "Living off the yield",
    perpLead: "How much must sit earning so the interest alone covers a bill, without ever touching the principal:",
    perpTarget: "Monthly bill",
    perpNeed: "Principal needed",
    perpHave: "Already have",
    perpGap: "Short by",
    perpDone: "Covered — the yield pays this bill on its own.",
    presetCosts: "SOPA's fixed costs",
    presetStream: "the current stream",
    reset: "Back to today's numbers",
    caveat:
      "APY is not fixed — it moves with market demand. Treat this as an estimate, not a guarantee. And since yield compounds, contributing early beats contributing more.",
    yr: "year",
    yrs: "years",
  },
} as const;

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 1000 ? 2 : 0 });

/** Future value of a principal plus a monthly contribution, compounded monthly. */
function project(principal: number, monthly: number, apy: number, months: number) {
  const r = apy / 12;
  if (months <= 0) return principal;
  // Principal compounds; each contribution compounds for the months it's present.
  const grown = principal * Math.pow(1 + r, months);
  const fromContribs = r === 0 ? monthly * months : monthly * ((Math.pow(1 + r, months) - 1) / r);
  return grown + fromContribs;
}

function Field({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = "1",
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-foreground-faint">{label}</span>
      <span className="mt-1 flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 focus-within:border-border-strong">
        {prefix && <span className="text-xs text-foreground-faint">{prefix}</span>}
        <input
          type="number"
          min={0}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          className="w-full min-w-0 bg-transparent font-mono text-sm tabular-nums text-foreground outline-none"
        />
        {suffix && <span className="text-xs text-foreground-faint">{suffix}</span>}
      </span>
      {hint && <span className="mt-0.5 block text-[10px] text-foreground-faint">{hint}</span>}
    </label>
  );
}

function Stat({ label, value, sub, tone = "text-foreground" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface-elevated px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-foreground-faint">{sub}</div>}
    </div>
  );
}

export function StakingCalculator({
  lang,
  liveStakedUsd,
  liveApy,
  monthlyCostsUsd,
  streamMonthlyUsd,
}: {
  lang: Lang;
  liveStakedUsd: number;
  /** Net APY as a fraction (0.0438). Falls back to a conservative 4% if unknown. */
  liveApy: number | null;
  monthlyCostsUsd: number;
  streamMonthlyUsd: number;
}) {
  const t = T[lang];
  const defaults = {
    principal: Math.round(liveStakedUsd),
    monthly: 0,
    apyPct: Number((((liveApy ?? 0.04) * 100)).toFixed(2)),
    years: 5,
    target: Number(Math.max(monthlyCostsUsd, 1).toFixed(2)),
  };

  const [principal, setPrincipal] = useState(defaults.principal);
  const [monthly, setMonthly] = useState(defaults.monthly);
  const [apyPct, setApyPct] = useState(defaults.apyPct);
  const [years, setYears] = useState(defaults.years);
  const [target, setTarget] = useState(defaults.target);

  const apy = apyPct / 100;

  const { future, contributed, earned, monthlyNow, series } = useMemo(() => {
    const months = Math.round(years * 12);
    const future = project(principal, monthly, apy, months);
    const contributed = principal + monthly * months;
    return {
      future,
      contributed,
      earned: future - contributed,
      monthlyNow: (principal * apy) / 12,
      series: Array.from({ length: Math.min(Math.max(Math.round(years), 1), 10) }, (_, i) => ({
        year: i + 1,
        value: project(principal, monthly, apy, (i + 1) * 12),
      })),
    };
  }, [principal, monthly, apy, years]);

  // Perpetuity: principal whose yield alone covers `target` every month.
  const need = apy > 0 ? (target * 12) / apy : Infinity;
  const covered = principal >= need;
  const maxSeries = Math.max(...series.map((s) => s.value), 1);

  const isDefault =
    principal === defaults.principal && monthly === defaults.monthly && apyPct === defaults.apyPct && years === defaults.years && target === defaults.target;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calculator className="h-4 w-4 text-accent" /> {t.title}
        </h4>
        {!isDefault && (
          <button
            type="button"
            onClick={() => {
              setPrincipal(defaults.principal);
              setMonthly(defaults.monthly);
              setApyPct(defaults.apyPct);
              setYears(defaults.years);
              setTarget(defaults.target);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> {t.reset}
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-foreground-subtle">{t.lead}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t.principal} value={principal} onChange={setPrincipal} prefix="$" hint={`${t.live}: ${usd(liveStakedUsd)}`} />
        <Field label={t.monthly} value={monthly} onChange={setMonthly} prefix="$" />
        <Field
          label={t.apy}
          value={apyPct}
          onChange={setApyPct}
          suffix="%"
          step="0.1"
          hint={liveApy != null ? `${t.live}: ${(liveApy * 100).toFixed(2)}%` : undefined}
        />
        <Field label={t.years} value={years} onChange={setYears} suffix={years === 1 ? t.yr : t.yrs} />
      </div>

      {/* What it becomes */}
      <h5 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-foreground-faint">{t.resultH}</h5>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.future} value={usd(future)} tone="text-accent" />
        <Stat label={t.contributed} value={usd(contributed)} />
        <Stat label={t.earned} value={usd(earned)} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label={t.perMonth} value={usd(monthlyNow)} sub={t.perMonthNow} />
      </div>

      {/* Year by year — one hue, magnitude by length. */}
      <h5 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-foreground-faint">{t.projH}</h5>
      <ul className="space-y-1">
        {series.map((s) => (
          <li key={s.year} className="flex items-center gap-2.5 text-xs">
            <span className="w-12 shrink-0 tabular-nums text-foreground-faint">
              {s.year} {s.year === 1 ? t.yr : t.yrs}
            </span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${(s.value / maxSeries) * 100}%` }} />
            </span>
            <span className="w-20 shrink-0 text-right font-mono tabular-nums text-foreground">{usd(s.value)}</span>
          </li>
        ))}
      </ul>

      {/* Perpetuity */}
      <div className="mt-5 rounded-xl border border-border bg-surface-elevated p-4">
        <h5 className="text-[11px] font-semibold uppercase tracking-widest text-foreground-faint">{t.perpH}</h5>
        <p className="mt-1 text-xs text-foreground-muted">{t.perpLead}</p>

        <div className="mt-2.5 flex flex-wrap items-end gap-3">
          <div className="w-36">
            <Field label={t.perpTarget} value={target} onChange={setTarget} prefix="$" suffix="/m" step="0.5" />
          </div>
          <div className="flex flex-wrap gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => setTarget(Number(monthlyCostsUsd.toFixed(2)))}
              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-muted hover:border-border-strong hover:text-foreground"
            >
              {t.presetCosts} · {usd(monthlyCostsUsd)}
            </button>
            {streamMonthlyUsd > 0 && (
              <button
                type="button"
                onClick={() => setTarget(Number(streamMonthlyUsd.toFixed(2)))}
                className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                {t.presetStream} · {usd(streamMonthlyUsd)}
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          <Stat label={t.perpNeed} value={Number.isFinite(need) ? usd(need) : "∞"} tone="text-accent" />
          <Stat label={t.perpHave} value={usd(principal)} />
          <Stat
            label={covered ? "✓" : t.perpGap}
            value={covered ? "—" : usd(Math.max(0, need - principal))}
            tone={covered ? "text-success" : "text-warning"}
          />
        </div>
        {covered && <p className="mt-2 text-[11px] text-success">{t.perpDone}</p>}
      </div>

      <p className="mt-3 text-[11px] text-foreground-faint">{t.caveat}</p>
    </div>
  );
}
