"use client";

// Stake do MOR de um Safe no subnet da Gnars, a partir da linha do MOR na
// tabela de tokens (e do passo 3 do ciclo). Propõe, não executa: o batch
// (withdraw do Warehouse se houver + approve + deposit) entra na fila do
// Safe na Base e os donos assinam. Vale para qualquer Safe declarado — SOPA
// e SkateHive, desde 14/09/2026.

import { useState } from "react";
import { CheckCircle2, ExternalLink, Layers, Loader2 } from "lucide-react";
import { proposeMorRestake } from "@/app/actions/mor-restake";
import { useLocale } from "@/components/locale-provider";

export function MorStakeButton({ safe, compact = false }: { safe: string; compact?: boolean }) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.steps;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; amount: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await proposeMorRestake({ safe });
      if (r.ok) setDone({ url: r.url, amount: r.amount });
      else setErr(r.error);
    } catch {
      setErr(t.stakeMor);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-success">
        <CheckCircle2 className="h-3 w-3" /> {t.restakeQueued(done.amount)}
        <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
          {dict.treasury.capital.claimQueueLink} <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
            : "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition disabled:opacity-50"
        }
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
        {busy ? t.proposingStake : t.stakeMor}
      </button>
      {err && <p className="text-[11px] text-warning">{err}</p>}
    </div>
  );
}
