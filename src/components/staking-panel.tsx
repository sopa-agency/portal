"use client";

import { useState, useTransition } from "react";
import { PiggyBank, Loader2, ExternalLink, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { proposeStake, proposeUnstake } from "@/app/actions/staking";
import type { StakePosition } from "@/lib/staking";
import { usd } from "@/lib/format";
import { ReadFailed } from "@/components/data-state";

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

// "Superstaking" — the Morpho position that funds the payroll stream. Read the
// live value + APY; propose deposits/withdrawals to the Safe (owners sign).
export function StakingPanel({ position, canEdit }: { position: StakePosition; canEdit: boolean }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setErr(null);
      setDone(null);
      const res = await (mode === "stake" ? proposeStake(amount) : proposeUnstake(amount));
      if (res.ok) {
        setDone(res.url);
        setAmount("");
      } else setErr(res.error);
    });

  return (
    <section className="rounded-2xl border border-success/40 bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <PiggyBank className="h-4 w-4 text-success" /> O cofre
        </h2>
        <span className="font-mono text-[11px] text-foreground-faint">Moonwell Flagship USDC</span>
      </div>

      {position.failed ? (
        <ReadFailed>
          Não consegui ler o cofre agora (a rede pública engasgou). Recarregue em instantes — prefiro não mostrar número nenhum a mostrar um errado.
        </ReadFailed>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Guardado</div>
            <div className="text-sm font-semibold tabular-nums text-foreground">{usd(position.valueUsd)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Rendimento ao ano</div>
            <div className="text-sm font-semibold tabular-nums text-success">
              {position.apy != null ? pct(position.apy) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Rende por mês</div>
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {position.monthlyYieldUsd != null ? usd(position.monthlyYieldUsd) : "—"}
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-foreground-subtle">
        O cofre guarda o dinheiro do time rendendo juros. Esse rendimento é o teto do que dá pra pagar sem comer o principal.
      </p>

      {canEdit && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-2 flex gap-1">
            {(["stake", "unstake"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                  mode === m ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"
                }`}
              >
                {m === "stake" ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                {m === "stake" ? "Guardar" : "Retirar"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label={mode === "stake" ? "Valor a guardar em USDC" : "Valor a retirar em USDC"}
              placeholder="USDC"
              className="w-32 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || !amount}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Propor no Safe
            </button>
          </div>
          {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
          {done && (
            <p className="mt-2 text-[11px] text-foreground-muted">
              Proposta na fila do Safe.{" "}
              <a href={done} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Abrir no Safe <ExternalLink className="h-3 w-3" />
              </a>{" "}
              (guardar = aprovar + depositar, numa proposta só).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
