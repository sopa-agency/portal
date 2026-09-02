"use client";

// O botão que traz o MOR da capital de volta.
//
// Ele PROPÕE, não executa: o servidor monta a transação, mede a taxa da ponte
// contra o próprio contrato e enfileira no Safe; os donos assinam no Safe{Wallet}.
// Não pede carteira nenhuma aqui — quem assina não é quem clica.
//
// O botão só existe quando há o que reclamar e a trava já venceu. Um botão que
// aparece travado convida ao clique e devolve um revert de quatro letras (`d_O`,
// que é como o contrato diz "faltou taxa"); a tela prefere não oferecer.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, HandCoins } from "lucide-react";
import { proposeCapitalClaim } from "@/app/actions/capital-claim";
import { useLocale } from "@/components/locale-provider";

export function CapitalClaimButton() {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; mor: string; fee: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const res = await proposeCapitalClaim();
      if (res.ok) setDone({ url: res.url, mor: res.mor, fee: res.feeEth });
      else setErr(res.error);
    } catch {
      setErr("Falha ao propor o claim.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandCoins className="h-3.5 w-3.5" />}
        {busy ? t.claimMeasuring : t.claimAction}
      </button>

      {done && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[11px] leading-relaxed text-success">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {t.claimQueued(done.mor, done.fee)}
          <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
            {t.claimQueueLink} <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      )}

      {err && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {err}
        </p>
      )}
    </div>
  );
}
