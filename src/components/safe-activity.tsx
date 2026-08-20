import { ExternalLink, Clock, CheckCircle2, XCircle } from "lucide-react";
import type { SafeActivity as SafeActivityData, SafeTxView } from "@/lib/safe-tx";
import { safeAppChainPrefix } from "@/lib/safe-tx";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionary";

type SafeT = Dictionary["treasury"]["safeTx"];

export type SafeActivityItem = {
  label: string;
  address: string;
  chainId: number;
  activity: SafeActivityData;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtDate = (d: string | null, intlLocale: string) =>
  d ? new Date(d).toLocaleDateString(intlLocale, { day: "2-digit", month: "short" }) : "";

function TxRow({ tx, chainId, t, intlLocale }: { tx: SafeTxView; chainId: number; t: SafeT; intlLocale: string }) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-xs">
      <span className="font-mono tabular-nums text-foreground-faint">#{tx.nonce}</span>
      <span className="min-w-0 flex-1 truncate text-foreground-muted">{tx.action}</span>
      {tx.executed ? (
        tx.success === false ? (
          <span className="flex items-center gap-1 text-danger"><XCircle className="h-3 w-3" /> {t.failed}</span>
        ) : (
          <a
            href={`https://${chainId === 1 ? "etherscan.io" : "basescan.org"}/tx/${tx.executionTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-success hover:underline"
          >
            <CheckCircle2 className="h-3 w-3" /> {t.executed} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )
      ) : (
        <span className="flex items-center gap-1 text-warning">
          <Clock className="h-3 w-3" /> {tx.confirmations}/{tx.required}
        </span>
      )}
      <span className="shrink-0 text-foreground-faint">{fmtDate(tx.submissionDate, intlLocale)}</span>
    </li>
  );
}

/** Read-only Safe transaction activity (pending queue + recent executed) per Safe wallet. */
export async function SafeActivity({ safes }: { safes: SafeActivityItem[] }) {
  if (safes.length === 0) return null;
  const t = (await getDictionary()).treasury.safeTx;
  const intlLocale = (await getLocale()) === "pt" ? "pt-BR" : "en-US";
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-foreground-subtle">{t.title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {safes.map((s) => {
          const queueUrl = `https://app.safe.global/transactions/queue?safe=${safeAppChainPrefix(s.chainId)}:${s.address}`;
          return (
            <div key={s.address} className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{s.label}</p>
                  <p className="font-mono text-[11px] text-foreground-faint">{short(s.address)} · {t.threshold(s.activity.threshold)}</p>
                </div>
                <a href={queueUrl} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:border-border-strong hover:text-foreground">
                  Safe <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {s.activity.queued.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-warning">{t.queued(s.activity.queued.length)}</p>
                  <ul className="divide-y divide-border/60">
                    {s.activity.queued.map((tx) => (
                      <TxRow key={tx.safeTxHash} tx={tx} chainId={s.chainId} t={t} intlLocale={intlLocale} />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-foreground-faint">{t.noQueued}</p>
              )}

              {s.activity.history.length > 0 && (
                <details className="mt-2 group">
                  <summary className="cursor-pointer list-none text-[11px] text-foreground-muted hover:text-foreground">
                    {t.history(s.activity.history.length)} ▾
                  </summary>
                  <ul className="mt-1 divide-y divide-border/60">
                    {s.activity.history.map((tx) => (
                      <TxRow key={tx.safeTxHash} tx={tx} chainId={s.chainId} t={t} intlLocale={intlLocale} />
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
