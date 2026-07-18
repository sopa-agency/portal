"use client";

import { useState, useTransition } from "react";
import { Layers, Loader2, Check, X, SlidersHorizontal, PiggyBank, Users2, Cog, Wallet } from "lucide-react";
import { setAllocation, type Allocation } from "@/app/actions/allocation";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

// "Pra que é cada parte do dinheiro" — the treasury is ONE staked pot; these are
// earmarks on top of it. Each bucket shows what it holds (its share of the pot)
// against what it actually needs, derived from real numbers:
//   Salários  → principal needed so the yield covers the stream (rate ÷ APY)
//   Custos    → N months of the real fixed costs
//   Orçamento → free capital, no target
const BUCKETS = [
  { key: "salariosPct", label: "Salários", icon: Users2, color: "#10b981", hint: "Banca o pagamento do time. O ideal é render o suficiente pra cobrir a torneira sem tocar no principal." },
  { key: "custosPct", label: "Custos operacionais", icon: Cog, color: "#f59e0b", hint: "Infra e ferramentas. A meta é ter alguns meses de custo cobertos." },
  { key: "orcamentoPct", label: "Orçamento livre", icon: Wallet, color: "#6366f1", hint: "Capital de giro pra pagamentos avulsos — sem meta fixa." },
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
  initial: Allocation;
  /** Everything the treasury holds (staked + free + reserve). */
  totalUsd: number;
  /** How much of it is already earning in the vault. */
  stakedUsd: number;
  canEdit: boolean;
  streamMonthlyUsd: number;
  apy: number | null;
  monthlyCostsUsd: number;
  costMonthsTarget?: number;
}) {
  const [alloc, setAlloc] = useState<Allocation>(initial);
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
        setDraft(null);
      } else setErr(res.error);
    });

  const stakedPct = totalUsd > 0 ? (stakedUsd / totalUsd) * 100 : 0;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Layers className="h-4 w-4 text-accent" /> Pra que é cada parte do dinheiro
        </h2>
        {canEdit && !draft && (
          <button
            type="button"
            onClick={() => setDraft(alloc)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Ajustar fatias
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-foreground-subtle">
        Só o caixa da <b>SOPA</b> (os tesouros das marcas são dinheiro à parte, em multisigs próprios). O dinheiro fica todo junto no cofre
        rendendo — isto aqui é só a etiqueta de <em>pra que serve cada parte</em>. Mudar não move nada; você só saca na hora de usar.
      </p>

      {/* Stacked bar */}
      <div className="mb-2 flex h-3.5 overflow-hidden rounded-full bg-border">
        {BUCKETS.map((b) => (
          <div
            key={b.key}
            className="h-full first:rounded-l-full"
            style={{ width: `${cur[b.key]}%`, backgroundColor: b.color }}
            title={`${b.label} · ${cur[b.key]}%`}
          />
        ))}
        {free > 0 && <div className="h-full rounded-r-full bg-foreground/10" style={{ width: `${free}%` }} title={`Sem destino · ${free}%`} />}
      </div>
      <div className="mb-4 flex items-center justify-between text-[11px] text-foreground-faint">
        <span>
          Caixa da SOPA <span className="font-semibold tabular-nums text-foreground">{usd(totalUsd)}</span>
        </span>
        <span className={sum > 100 ? "text-danger" : ""}>
          {sum}% destinado{free > 0 ? ` · ${free}% sem destino` : ""}
        </span>
      </div>

      {/* Buckets */}
      <ul className="space-y-2.5">
        {BUCKETS.map((b) => {
          const pct = cur[b.key];
          const value = (totalUsd * pct) / 100;
          const need = needs[b.key];
          const covered = need == null ? null : value >= need;
          const Icon = b.icon;
          return (
            <li key={b.key} className="rounded-xl border border-border bg-surface-elevated p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" style={{ color: b.color }} />
                <span className="text-sm font-medium text-foreground">{b.label}</span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{usd(value)}</span>
                <span className="w-10 text-right text-xs tabular-nums text-foreground-faint">{pct}%</span>
              </div>
              <p className="mt-1 text-[11px] text-foreground-subtle">{b.hint}</p>

              {draft && canEdit && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => setDraft({ ...cur, [b.key]: Number(e.target.value) })}
                    className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent"
                    aria-label={`Fatia de ${b.label}`}
                  />
                  <span className="w-10 text-right text-xs tabular-nums text-foreground">{pct}%</span>
                </div>
              )}

              {need != null && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-foreground-muted">
                    precisa de <span className="font-semibold tabular-nums text-foreground">{usd(need)}</span>
                  </span>
                  <span className={`rounded-full px-1.5 py-0.5 font-semibold ${covered ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                    {covered ? "coberto" : `faltam ${usd(Math.max(0, need - value))}`}
                  </span>
                  <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, need > 0 ? (value / need) * 100 : 0)}%`, backgroundColor: covered ? "var(--success)" : "var(--warning)" }}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}

      {draft && canEdit && (
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => { setDraft(null); setErr(null); }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || sum > 100}
            className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar fatias
          </button>
        </div>
      )}

      {/* How much of the pot is actually earning */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-foreground-muted">
            <PiggyBank className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> No cofre rendendo
          </span>
          <span className="tabular-nums text-foreground-muted">
            <span className="font-semibold text-foreground">{usd(stakedUsd)}</span> de {usd(totalUsd)} · {Math.round(stakedPct)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(stakedPct, stakedUsd > 0 ? 2 : 0)}%` }} />
        </div>
        {stakedPct < 80 && (
          <p className="mt-1.5 text-[11px] text-warning">
            {usd(totalUsd - stakedUsd)} parado sem render — guarde no cofre (Controles → Guardar dinheiro rendendo). Continua disponível: você saca quando precisar.
          </p>
        )}
      </div>
    </section>
  );
}
