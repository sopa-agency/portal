"use client";

import { useState, useTransition } from "react";
import { Layers, Loader2, Check, X, SlidersHorizontal, PiggyBank, Users2, Cog, Wallet } from "lucide-react";
import { setAllocation, type Allocation, type StoredAllocation } from "@/app/actions/allocation";
import { usd } from "@/lib/format";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

// "Pra que é cada parte do dinheiro" — the treasury is ONE staked pot; these are
// earmarks on top of it. Each bucket shows what it holds (its share of the pot)
// against what it actually needs, derived from real numbers:
//   Salários  → principal needed so the yield covers the stream (rate ÷ APY)
//   Custos    → N months of the real fixed costs
//   Orçamento → free capital, no target
// Colors are theme tokens (--viz-*), stepped per mode and validated for the
// lightness band, chroma floor, CVD separation and 3:1 contrast in BOTH themes.
// Labels/hints come from the dictionary; only the key, icon and color are data.
const BUCKETS = [
  { key: "salariosPct", name: "salaries", icon: Users2, color: "var(--viz-1)" },
  { key: "custosPct", name: "costs", icon: Cog, color: "var(--viz-2)" },
  { key: "orcamentoPct", name: "budget", icon: Wallet, color: "var(--viz-3)" },
] as const;

type Key = (typeof BUCKETS)[number]["key"];

export function TreasuryAllocation({
  initial,
  totalUsd,
  stakedUsd,
  canEdit,
  streamMonthlyUsd,
  apy,
  monthlyCostsUsd,
  costMonthsTarget = 6,
}: {
  initial: StoredAllocation;
  /** Everything the treasury holds (staked + free + reserve). */
  totalUsd: number;
  /** How much of it is already earning in the vault. */
  /** NULL = a posição em stake não pôde ser lida. Não é zero: a barra e a
   *  porcentagem dependem dela, e desconhecido virando 0 desenharia "nada em
   *  stake" — que foi literalmente o incidente 3af9642. */
  stakedUsd: number | null;
  canEdit: boolean;
  streamMonthlyUsd: number;
  apy: number | null;
  monthlyCostsUsd: number;
  costMonthsTarget?: number;
}) {
  const t = useT().treasury.allocation;
  const label = (name: (typeof BUCKETS)[number]["name"]) =>
    name === "salaries" ? t.buckets.salaries : name === "costs" ? t.buckets.costs : t.buckets.budget;
  const hintFor = (name: (typeof BUCKETS)[number]["name"]) =>
    name === "salaries" ? t.buckets.salariesHint : name === "costs" ? t.buckets.costsHint : t.buckets.budgetHint;
  const [alloc, setAlloc] = useState<Allocation>(initial);
  const [saved, setSaved] = useState(initial.saved);
  const [draft, setDraft] = useState<Allocation | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const cur = draft ?? alloc;
  const sum = cur.salariosPct + cur.custosPct + cur.orcamentoPct;
  const free = 100 - sum;

  // What each bucket needs, from live numbers.
  const needs: Record<Key, number | null> = {
    salariosPct: apy && apy > 0 && streamMonthlyUsd > 0 ? (streamMonthlyUsd * 12) / apy : null,
    custosPct: monthlyCostsUsd > 0 ? monthlyCostsUsd * costMonthsTarget : null,
    orcamentoPct: null,
  };

  const save = () =>
    start(async () => {
      setErr(null);
      const res = await setAllocation(cur);
      if (res.ok) {
        setAlloc(res.allocation);
        setSaved(true);
        setDraft(null);
      } else setErr(res.error);
    });

  const stakedPct = stakedUsd != null && totalUsd > 0 ? (stakedUsd / totalUsd) * 100 : 0;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Layers className="h-4 w-4 text-accent" /> {t.title}
          {!saved && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              {t.suggestion}
            </span>
          )}
        </h2>
        {canEdit && !draft && (
          <button
            type="button"
            onClick={() => setDraft(alloc)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t.adjust}
          </button>
        )}
      </div>
      {!saved && (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-[11px] text-warning">
          {rich(t.unsaved)}
        </p>
      )}
      <p className="mb-4 text-xs text-foreground-subtle">
        {rich(t.hint)}
      </p>

      {/* The pot as a vessel: one cylinder, filled bottom-up. Deliberately FLAT —
          no 3D ellipses or perspective, which would distort the very proportions
          the chart exists to show. Segment heights stay linear in the percentage. */}
      {/* items-center keeps the tube optically centered against the legend block
          instead of towering past its last row. */}
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5 sm:justify-start">
        <figure className="m-0 flex shrink-0 flex-col items-center">
          <figcaption className="mb-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-foreground-faint">{t.potLabel}</div>
            <div className="font-mono text-lg font-bold tabular-nums text-foreground">{usd(totalUsd)}</div>
          </figcaption>
          <div
            className="flex w-[72px] flex-col-reverse gap-[2px] overflow-hidden rounded-[36px] border border-border bg-surface-elevated p-[3px]"
            style={{ height: 224 }}
            role="img"
            aria-label={BUCKETS.map((b) => `${label(b.name)} ${cur[b.key]}%`).join(", ") + (free > 0 ? `, ${t.unassigned} ${free}%` : "")}
          >
            {BUCKETS.map((b, idx) => {
              const pct = cur[b.key];
              if (pct <= 0) return null;
              return (
                <div
                  key={b.key}
                  className={`flex min-h-0 items-center justify-center transition-[height] duration-200 ${
                    idx === 0 ? "rounded-b-[33px]" : ""
                  } ${free <= 0 && idx === BUCKETS.length - 1 ? "rounded-t-[33px]" : ""}`}
                  style={{ height: `${pct}%`, backgroundColor: b.color }}
                  title={`${label(b.name)} · ${pct}% · ${usd((totalUsd * pct) / 100)}`}
                >
                  {/* Direct-label only where the text actually fits. */}
                  {pct >= 12 && <span className="font-mono text-[11px] font-bold text-white/95">{pct}%</span>}
                </div>
              );
            })}
            {free > 0 && (
              <div
                className="flex min-h-0 items-center justify-center rounded-t-[33px] bg-foreground/[0.07]"
                style={{ height: `${free}%` }}
                title={t.unassignedTitle(free)}
              >
                {free >= 12 && <span className="font-mono text-[11px] font-semibold text-foreground-faint">{free}%</span>}
              </div>
            )}
          </div>
          <div className={`mt-2 text-[10px] tabular-nums ${sum > 100 ? "text-danger" : "text-foreground-faint"}`}>
            {t.earmarked(sum)}
          </div>
        </figure>

        {/* Legend — identity is never color-alone: swatch + icon + name + value. */}
        <ul className="min-w-[260px] flex-1 divide-y divide-border">
          {BUCKETS.map((b) => {
            const pct = cur[b.key];
            const value = (totalUsd * pct) / 100;
            const need = needs[b.key];
            const covered = need == null ? null : value >= need;
            const Icon = b.icon;
            return (
              <li key={b.key} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: b.color }} />
                  <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                  <span className="text-sm font-medium text-foreground">{label(b.name)}</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{usd(value)}</span>
                  <span className="w-9 text-right text-xs tabular-nums text-foreground-faint">{pct}%</span>
                </div>
                <p className="mt-0.5 pl-[22px] text-[11px] text-foreground-subtle">{hintFor(b.name)}</p>

                {draft && canEdit && (
                  <div className="mt-1.5 flex items-center gap-2 pl-[22px]">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => setDraft({ ...cur, [b.key]: Number(e.target.value) })}
                      className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent"
                      aria-label={t.sliceOf(label(b.name))}
                    />
                    <span className="w-9 text-right text-xs tabular-nums text-foreground">{pct}%</span>
                  </div>
                )}

                {need != null && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-[22px] text-[11px]">
                    <span className="text-foreground-muted">
                      {t.needs} <span className="font-semibold tabular-nums text-foreground">{usd(need)}</span>
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${covered ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {covered ? t.covered : t.missing(usd(Math.max(0, need - value)))}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          {free > 0 && (
            <li className="flex items-center gap-2 text-[11px] text-foreground-faint">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-foreground/[0.12]" />
              {t.unassigned}
              <span className="ml-auto tabular-nums">{usd((totalUsd * free) / 100)}</span>
              <span className="w-9 text-right tabular-nums">{free}%</span>
            </li>
          )}
        </ul>
      </div>

      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}

      {draft && canEdit && (
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => { setDraft(null); setErr(null); }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> {t.cancel}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || sum > 100}
            className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t.save}
          </button>
        </div>
      )}

      {/* How much of the pot is actually earning */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-foreground-muted">
            <PiggyBank className="h-3.5 w-3.5 text-success" /> {t.inVault}
          </span>
          <span className="tabular-nums text-foreground-muted">
            {stakedUsd == null
              ? t.stakeUnread
              : rich(t.ofTotal(usd(stakedUsd), usd(totalUsd), Math.round(stakedPct)))}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${Math.max(stakedPct, (stakedUsd ?? 0) > 0 ? 2 : 0)}%` }}
          />
        </div>
        {/* "Parado: $X" é conselho, e conselho sobre subtração com um termo
            desconhecido é palpite. Sem a posição, o aviso não aparece — some o
            conselho, não o motivo, que já está dito acima. */}
        {stakedUsd != null && stakedPct < 80 && (
          <p className="mt-1.5 text-[11px] text-warning">
            {t.idle(usd(totalUsd - stakedUsd))}
          </p>
        )}
      </div>
    </section>
  );
}
