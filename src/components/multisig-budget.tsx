import { Coins, ExternalLink } from "lucide-react";
import type { SafeBudget } from "@/lib/safe-tx";
import { safeAppChainPrefix } from "@/lib/safe-tx";
import { TokenLogo } from "@/components/token-logo";
import { getDictionary } from "@/lib/i18n/server";

export type ProjectBudget = {
  slug: string;
  name: string;
  address: string;
  chains: SafeBudget[];
};

const CHAIN_LABEL: Record<number, string> = { 8453: "Base", 1: "Ethereum" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

// Only ETH + USDC matter for the bounty budget. ETH absorbs WETH; everything
// else is ignored. Brand colors read on both themes (chart-color exemption).
const TOKEN_COLOR: Record<"ETH" | "USDC", string> = { ETH: "#627eea", USDC: "#2775ca" };
type Holding = { symbol: "ETH" | "USDC"; balance: number; usd: number };

function reduceChain(b: SafeBudget): { holdings: Holding[]; total: number } {
  let ethBal = 0, ethUsd = 0, usdcBal = 0, usdcUsd = 0;
  for (const t of b.tokens) {
    const sym = t.symbol.toUpperCase();
    const bal = Number(t.balance) || 0;
    const u = t.usd ?? 0;
    if (sym === "ETH" || sym === "WETH") { ethBal += bal; ethUsd += u; }
    else if (sym === "USDC") { usdcBal += bal; usdcUsd += u; }
  }
  const holdings: Holding[] = [];
  if (ethBal > 0 || ethUsd > 0) holdings.push({ symbol: "ETH", balance: ethBal, usd: ethUsd });
  if (usdcBal > 0 || usdcUsd > 0) holdings.push({ symbol: "USDC", balance: usdcBal, usd: usdcUsd });
  return { holdings, total: ethUsd + usdcUsd };
}

const budgetTotal = (b: ProjectBudget) => b.chains.reduce((s, ch) => s + reduceChain(ch).total, 0);

/**
 * Highlighted "operational budget" view — the project's bounty multisig(s) and
 * their spendable ETH + USDC per chain — shown separately from the DAO treasury.
 */
export async function MultisigBudgets({ budgets }: { budgets: ProjectBudget[] }) {
  if (budgets.length === 0) return null;
  const t = (await getDictionary()).treasury.budget;
  const total = budgets.reduce((s, b) => s + budgetTotal(b), 0);

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Coins className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-none text-foreground">{t.title}</h2>
          <p className="mt-1 text-[11px] leading-none text-foreground-faint">{t.hint}</p>
        </div>
        {total > 0 && <span className="ml-auto text-lg font-bold tabular-nums text-foreground">{usd(total)}</span>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {budgets.map((b) => {
          const chains = b.chains
            .map((ch) => ({ chainId: ch.chainId, ...reduceChain(ch) }))
            .filter((ch) => ch.holdings.length > 0);
          const projTotal = budgetTotal(b);
          return (
            <div key={b.slug} className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{b.name}</span>
                <span className="text-sm font-bold tabular-nums text-foreground">{usd(projTotal)}</span>
              </div>

              {chains.length === 0 ? (
                <p className="text-[11px] text-foreground-faint">{t.empty}</p>
              ) : (
                <div className="space-y-3">
                  {chains.map((ch) => (
                    <div key={ch.chainId}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                          {CHAIN_LABEL[ch.chainId] ?? ch.chainId}
                          <a
                            href={`https://app.safe.global/balances?safe=${safeAppChainPrefix(ch.chainId)}:${b.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                            title={t.openInSafe}
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </span>
                        <span className="font-mono text-[10px] text-foreground-faint">{short(b.address)}</span>
                      </div>

                      <ul className="space-y-1.5">
                        {ch.holdings.map((h) => (
                          <li key={h.symbol} className="flex items-center gap-2">
                            <TokenLogo symbol={h.symbol} size={22} color={TOKEN_COLOR[h.symbol]} />
                            <span className="text-xs font-medium text-foreground">{h.symbol}</span>
                            <span className="tabular-nums text-[11px] text-foreground-faint">{fmt(h.balance)}</span>
                            <span className="ml-auto text-xs font-semibold tabular-nums text-foreground-muted">{usd(h.usd)}</span>
                          </li>
                        ))}
                      </ul>

                      {/* ETH vs USDC split */}
                      {ch.total > 0 && ch.holdings.length > 1 && (
                        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-border">
                          {ch.holdings.map((h) => (
                            <div
                              key={h.symbol}
                              className="h-full first:rounded-l-full last:rounded-r-full"
                              style={{ width: `${Math.max((h.usd / ch.total) * 100, 2)}%`, backgroundColor: TOKEN_COLOR[h.symbol] }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
