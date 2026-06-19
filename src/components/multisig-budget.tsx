import { Coins, ExternalLink } from "lucide-react";
import type { SafeBudget } from "@/lib/safe-tx";
import { safeAppChainPrefix } from "@/lib/safe-tx";

export type ProjectBudget = {
  slug: string;
  name: string;
  address: string;
  chains: SafeBudget[];
};

const CHAIN_LABEL: Record<number, string> = { 8453: "Base", 1: "Ethereum" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const fmt = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * Highlighted "operational budget" view — the project's bounty multisig(s) and
 * their spendable balances per chain — shown separately from the DAO treasury.
 */
export function MultisigBudgets({ budgets }: { budgets: ProjectBudget[] }) {
  if (budgets.length === 0) return null;
  const total = budgets.reduce((s, b) => s + b.chains.reduce((c, ch) => c + ch.totalUsd, 0), 0);

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Coins className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-none text-foreground">Orçamento de bounties</h2>
          <p className="mt-1 text-[11px] leading-none text-foreground-faint">multisig operacional — separado do tesouro do DAO</p>
        </div>
        {total > 0 && <span className="ml-auto text-lg font-bold tabular-nums text-foreground">{usd(total)}</span>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {budgets.map((b) => (
          <div key={b.slug} className="rounded-xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{b.name}</span>
              <span className="font-mono text-[10px] text-foreground-faint">{short(b.address)}</span>
            </div>

            <div className="space-y-2.5">
              {b.chains.map((ch) => (
                <div key={ch.chainId}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                      {CHAIN_LABEL[ch.chainId] ?? ch.chainId}
                      <a href={`https://app.safe.global/balances?safe=${safeAppChainPrefix(ch.chainId)}:${b.address}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" title="Abrir no Safe">
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </span>
                    {ch.totalUsd > 0 && <span className="text-xs font-semibold tabular-nums text-foreground-muted">{usd(ch.totalUsd)}</span>}
                  </div>
                  {ch.tokens.length === 0 ? (
                    <p className="text-[11px] text-foreground-faint">vazio</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {ch.tokens.map((t) => (
                        <li key={t.symbol} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="tabular-nums text-foreground">{fmt(t.balance)} <span className="text-foreground-muted">{t.symbol}</span></span>
                          {t.usd != null && <span className="tabular-nums text-[11px] text-foreground-faint">{usd(t.usd)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
