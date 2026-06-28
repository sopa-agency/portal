"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { refreshTreasury } from "@/app/actions/treasury";

/** Manual refresh — busts the 5-min treasury cache and re-renders with live data. */
export function TreasuryRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const busy = pending || spinning;

  const onClick = () => {
    setSpinning(true);
    startTransition(async () => {
      await refreshTreasury().catch(() => {});
      router.refresh();
      // let the route re-render before clearing the spinner
      setTimeout(() => {
        setSpinning(false);
        setDoneAt(Date.now());
      }, 700);
    });
  };

  return (
    <div className="flex items-center gap-2">
      {doneAt && !busy && (
        <span className="text-[11px] text-foreground-faint">atualizado agora</span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title="Atualizar saldos (ignora o cache de 5 min)"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Atualizando…" : "Atualizar"}
      </button>
    </div>
  );
}
