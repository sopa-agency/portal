import { PiggyBank, ArrowRight } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";

// Header for the Apoiar tab: the deposit→earn→split step pills and the 4-stat
// strip. Server component — every number is live, nothing to hydrate. Colors are
// theme tokens (SOPA's amber accent stands in for the design's gold) so it reads
// in both light and dark.

const usd = (n: number, tiny = false) =>
  n === 0 ? "$0" : tiny && n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : n < 1000 ? 2 : 0 })}`;

function Stat({
  label,
  value,
  unit,
  tone = "text-foreground",
  border = "border-border",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  border?: string;
}) {
  return (
    <div className={`rounded-2xl border ${border} bg-surface p-4`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-foreground-faint">{label}</div>
      <div className={`mt-2 font-mono text-xl font-semibold tabular-nums ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-foreground-faint">{unit}</span>}
      </div>
    </div>
  );
}

export async function VaultSupportSummary({
  depositedUsd,
  apy,
  liveYieldUsd,
  sopaEarnedUsd,
  feeToSopa,
}: {
  depositedUsd: number;
  /** Net APY a depositor keeps (fraction), or null until indexed. */
  apy: number | null;
  liveYieldUsd: number;
  sopaEarnedUsd: number;
  feeToSopa: number;
}) {
  const t = (await getDictionary()).treasury.vault;
  const feePct = Math.round(feeToSopa * 100);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{t.summaryTitle}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground-muted">
            {t.summaryHint}
          </p>
        </div>
        {/* Deposita → Rende → Divide */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {[
            { n: 1, label: t.stepDeposit, cls: "border-accent-border bg-accent-bg text-accent" },
            { n: 2, label: t.stepEarn, cls: "border-success/30 bg-success/10 text-success" },
            { n: 3, label: t.stepSplit(feePct), cls: "border-border bg-surface text-foreground-muted" },
          ].map((s, i, arr) => (
            <div key={s.n} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${s.cls}`}>
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-current text-[11px] font-bold">
                  <span className="text-surface">{s.n}</span>
                </span>
                <span className="text-xs font-medium">{s.label}</span>
              </div>
              {i < arr.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-foreground-faint" />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t.statInVault} value={usd(depositedUsd)} unit="USDC" />
        <Stat
          label={t.statApy}
          value={apy != null ? `${(apy * 100).toFixed(2)}%` : "—"}
          unit={apy != null ? "APY" : undefined}
          tone="text-success"
          border="border-success/20"
        />
        <Stat label={t.statEarned} value={usd(liveYieldUsd, true)} />
        <Stat label={t.statToSopa} value={usd(sopaEarnedUsd, true)} tone="text-accent" border="border-accent-border" />
      </div>
    </div>
  );
}

/** Small standalone icon reused by the tab, kept here so the header owns its brand mark. */
export function SupportIcon() {
  return <PiggyBank className="h-4 w-4 text-accent" />;
}
