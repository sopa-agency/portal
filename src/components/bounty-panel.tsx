"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Loader2, Trash2, CalendarPlus } from "lucide-react";
import { createBounty, cancelBounty, proposeBountyPayment, markBountyPaid, type BountyDTO } from "@/app/actions/bounty";

/** Stable handle for a task across reloads: GitHub node id, then url, then item id. */
export function taskKeyOf(it: { contentId?: string | null; url?: string; id: string }): string {
  return it.contentId ?? it.url ?? it.id;
}

export function BountyBadge({ bounty }: { bounty: BountyDTO }) {
  const tone =
    bounty.status === "paid"
      ? "border-success/40 bg-success/10 text-success"
      : bounty.status === "proposed"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}>
      <Coins className="h-2.5 w-2.5" /> {bounty.amount} {bounty.tokenSymbol}
    </span>
  );
}

/** Deep-link to the meeting editor, pre-filled as an EXEC meeting for a task. */
export function ExecMeetingButton({
  projectSlug,
  title,
  body,
  logins,
  className,
}: {
  projectSlug: string;
  title: string;
  body?: string | null;
  logins: string[];
  className?: string;
}) {
  const router = useRouter();
  function go() {
    const prefill = { title, forProject: projectSlug, kind: "exec" as const, notes: body ?? "", logins };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(prefill))));
    router.push(`/reunioes?new=${encodeURIComponent(b64)}`);
  }
  return (
    <button type="button" onClick={go} className={className ?? "flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"}>
      <CalendarPlus className="h-4 w-4" /> Criar reunião EXEC
    </button>
  );
}

/**
 * Bounty lifecycle for one task, paid from the project's Safe. Global admins can
 * reserve a bounty, set the payee, propose the Safe payment, mark paid, or cancel.
 * Non-admins see read-only status. Renders nothing when there's no bounty and the
 * viewer can't manage.
 */
export function BountyPanel({
  projectSlug,
  taskKey,
  title,
  bounty,
  canManage,
  onChanged,
}: {
  projectSlug: string;
  taskKey: string;
  title: string;
  bounty: BountyDTO | undefined;
  canManage: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState(bounty?.payeeAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!bounty && !canManage) return null;

  async function refresh() {
    if (onChanged) await onChanged();
    else router.refresh();
  }
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: okText }); await refresh(); }
    else setMsg({ ok: false, text: r.error ?? "Falha." });
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-elevated p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Coins className="h-3.5 w-3.5 text-amber-500" /> Bounty
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}

      {!bounty && canManage && (
        <div className="flex items-end gap-2">
          <label className="flex-1 text-xs text-foreground-muted">Valor
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="ex.: 100" className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:border-border-strong focus:outline-none" />
          </label>
          <button type="button" onClick={() => run(() => createBounty({ projectSlug, taskKey, title, amount }), "Bounty criado ✅")} disabled={busy || !amount.trim()} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transformar em bounty"}
          </button>
        </div>
      )}

      {bounty && bounty.status === "open" && (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted">Reservado: <span className="font-semibold text-foreground">{bounty.amount} {bounty.tokenSymbol}</span>. Ao concluir, proponha o pagamento no Safe do projeto.</p>
          {canManage && (
            <>
              <label className="block text-xs text-foreground-muted">Carteira do beneficiário
                <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x… (carteira de quem entregou)" className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
              </label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => run(() => proposeBountyPayment(bounty.id, payee), "Pagamento proposto no Safe ✅ — aguarda aprovação dos owners.")} disabled={busy || !payee.trim()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Propor pagamento no Safe
                </button>
                <button type="button" onClick={() => run(() => cancelBounty(bounty.id), "Bounty cancelado.")} disabled={busy} title="Cancelar bounty" className="rounded-lg border border-border p-2 text-foreground-faint hover:border-danger hover:text-danger disabled:opacity-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {bounty && bounty.status === "proposed" && (
        <div className="text-xs text-foreground-muted">
          <p className="text-warning">Pagamento proposto no Safe — aguardando aprovação dos owners.</p>
          {bounty.payeeAddress && <p className="mt-1 font-mono text-[11px]">→ {bounty.payeeAddress}</p>}
          {bounty.safeTxHash && <p className="mt-0.5 truncate font-mono text-[10px] text-foreground-faint">{bounty.safeTxHash}</p>}
          {canManage && (
            <button type="button" onClick={() => run(() => markBountyPaid(bounty.id), "Marcado como pago ✅")} disabled={busy} className="mt-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/20 disabled:opacity-50">
              {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Marcar como pago"}
            </button>
          )}
        </div>
      )}

      {bounty && bounty.status === "paid" && (
        <p className="text-xs text-success">Pago ✅ {bounty.payeeAddress ? `→ ${bounty.payeeAddress}` : ""}</p>
      )}
    </div>
  );
}
