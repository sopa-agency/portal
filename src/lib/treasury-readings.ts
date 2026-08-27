import { ok, unread, type Reading } from "@/lib/reading";
import type { EvmWalletReport, HiveAccountReport } from "@/lib/treasury";

/**
 * How a wallet or an account turns into a term of a total.
 *
 * These live apart from `treasury.ts` on purpose: that module is `server-only`
 * (it holds RPC keys and fetch paths), while the aggregation that uses these
 * runs in a Client Component too. Importing a VALUE from a server-only module
 * drags the whole thing into the browser bundle — type imports are erased, so
 * the split had gone unnoticed until a value crossed it.
 */

/**
 * A wallet answers fully, or it doesn't answer.
 *
 * A wallet with a failed chain has a PARTIAL balance. That partial is worth
 * showing on its own row — it is what we did see — but it is not what the
 * wallet holds, so it cannot enter a sum that claims to be the treasury.
 */
export const evmWalletReading = (w: EvmWalletReport): Reading<number> =>
  w.failedChains.length > 0
    ? unread(`${w.label}: ${w.failedChains.join(", ")} não respondeu`)
    : ok(w.totalUsd);

/** Mesma moeda em duas carteiras é uma linha só na nota, não duas. */
export function mergeUnpriced(wallets: { unpriced: { symbol: string; balance: number }[] }[]) {
  const by = new Map<string, number>();
  for (const w of wallets) for (const u of w.unpriced) by.set(u.symbol, (by.get(u.symbol) ?? 0) + u.balance);
  return [...by].map(([symbol, balance]) => ({ symbol, balance }));
}

/** "account not found" is a failed read, not an account worth zero. */
export const hiveAccountReading = (a: HiveAccountReport): Reading<number> =>
  a.error ? unread(`${a.label}: ${a.error}`) : ok(a.usd);
