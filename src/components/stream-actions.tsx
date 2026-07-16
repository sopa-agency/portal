"use client";

import { useState, useTransition } from "react";
import { Settings2, Loader2, ExternalLink, RefreshCw, Package, Play, Square } from "lucide-react";
import { proposeSetUnits, proposeWrap, proposeSetFlow } from "@/app/actions/superfluid";

type Result = { ok: true; url: string } | { ok: false; error: string } | null;

// Actions to drive the payroll stream once the pool exists — all proposed to
// the Safe (owners sign). Sync weights, wrap USDC→USDCx, open/adjust/stop flow.
export function StreamActions({ canEdit }: { canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [wrapAmt, setWrapAmt] = useState("");
  const [monthly, setMonthly] = useState("");
  const [res, setRes] = useState<Result>(null);

  if (!canEdit) return null;

  const run = (key: string, fn: () => Promise<Result>) =>
    start(async () => {
      setBusyKey(key);
      setRes(null);
      setRes(await fn());
      setBusyKey(null);
    });

  const busy = (k: string) => pending && busyKey === k;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Settings2 className="h-4 w-4 text-accent" /> Ações do stream
      </h2>
      <p className="mb-3 text-xs text-foreground-subtle">
        Cada ação vira uma proposta no Safe (os signatários aprovam + executam). Ordem sugerida: sincronizar pesos → wrap → abrir stream.
      </p>

      <div className="space-y-3">
        {/* Sync weights */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run("units", proposeSetUnits)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
          >
            {busy("units") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar pesos → pool
          </button>
          <span className="text-[11px] text-foreground-faint">empurra os units dos membros ativos pra pool on-chain</span>
        </div>

        {/* Wrap */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={wrapAmt}
            onChange={(e) => setWrapAmt(e.target.value)}
            inputMode="decimal"
            placeholder="USDC"
            className="w-28 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() => run("wrap", () => proposeWrap(wrapAmt))}
            disabled={pending || !wrapAmt}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
          >
            {busy("wrap") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
            Wrap USDC → USDCx
          </button>
        </div>

        {/* Flow */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            inputMode="decimal"
            placeholder="$/mês"
            className="w-28 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() => run("flow", () => proposeSetFlow(monthly))}
            disabled={pending || !monthly}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
          >
            {busy("flow") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Abrir / ajustar stream
          </button>
          <button
            type="button"
            onClick={() => run("stop", () => proposeSetFlow("0"))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {busy("stop") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Parar
          </button>
        </div>
      </div>

      {res && !res.ok && <p className="mt-3 text-[11px] text-danger">{res.error}</p>}
      {res && res.ok && (
        <p className="mt-3 text-[11px] text-foreground-muted">
          Proposta na fila do Safe.{" "}
          <a href={res.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Abrir no Safe <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      )}
    </section>
  );
}
