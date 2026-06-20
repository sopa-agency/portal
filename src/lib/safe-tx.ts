import { getAddress, formatUnits } from "viem";

/** Safe Transaction Service base URL per chain. */
export function safeTxService(chainId: number): string {
  if (chainId === 1) return "https://safe-transaction-mainnet.safe.global";
  return "https://safe-transaction-base.safe.global"; // default Base (8453)
}

/** app.safe.global chain short-name prefix. */
export function safeAppChainPrefix(chainId: number): string {
  return chainId === 1 ? "eth" : "base";
}

/** Whether a Safe is deployed on a chain (+ its threshold). null on error. */
export async function fetchSafeInfo(safeAddress: string, chainId: number): Promise<{ exists: boolean; threshold: number } | null> {
  const tx = safeTxService(chainId);
  const addr = getAddress(safeAddress);
  // Retry transient failures (429/5xx/timeout) — Vercel's shared IPs get
  // rate-limited by the Safe service, which must NOT read as "not deployed".
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${tx}/api/v1/safes/${addr}/`, {
        headers: { Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(11000),
      });
      if (r.status === 404 || r.status === 422) return { exists: false, threshold: 0 };
      if (!r.ok) continue; // transient → retry, then null (unknown)
      const j = (await r.json()) as { threshold?: number };
      return { exists: true, threshold: Number(j.threshold ?? 0) };
    } catch {
      /* retry */
    }
  }
  return null;
}

export type SafeBudgetToken = { symbol: string; balance: string; usd: number | null };
export type SafeBudget = { chainId: number; tokens: SafeBudgetToken[]; totalUsd: number };

/** A Safe's spendable balance on one chain, with USD values — null if the Safe
 *  isn't deployed on that chain. Used for the treasury "multisig budget" view. */
export async function fetchSafeBudget(safeAddress: string, chainId: number): Promise<SafeBudget | null> {
  const tx = safeTxService(chainId);
  try {
    const r = await fetch(`${tx}/api/v1/safes/${getAddress(safeAddress)}/balances/?trusted=true`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null; // 404 = not a Safe on this chain
    const arr = (await r.json()) as { tokenAddress: string | null; token: { symbol?: string; decimals?: number } | null; balance: string; fiatBalance?: string | null }[];
    const STABLES = new Set(["USDC", "USDT", "DAI", "USDBC", "EURC", "USDS"]);
    const rank = (t: SafeBudgetToken, native: boolean) => (native ? 0 : STABLES.has(t.symbol.toUpperCase()) ? 1 : 2);
    const tokens = arr
      .filter((b) => Number(b.balance) > 0)
      .map((b): SafeBudgetToken & { _native: boolean } => ({
        symbol: b.token?.symbol ?? "ETH",
        balance: formatUnits(BigInt(b.balance), b.token?.decimals ?? 18),
        usd: b.fiatBalance != null && b.fiatBalance !== "" ? Number(b.fiatBalance) : null,
        _native: b.tokenAddress === null,
      }))
      // USD desc when known; else ETH → stablecoins → rest, then symbol.
      .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || rank(a, a._native) - rank(b, b._native) || a.symbol.localeCompare(b.symbol))
      .map(({ _native, ...t }) => { void _native; return t; });
    const totalUsd = tokens.reduce((s, t) => s + (t.usd ?? 0), 0);
    return { chainId, tokens, totalUsd };
  } catch {
    return null;
  }
}

export type SafeToken = {
  /** null = native ETH. */
  address: string | null;
  symbol: string;
  decimals: number;
  /** Human-readable balance held by the Safe (e.g. "0.001"). */
  balance: string;
};

/** Tokens (incl. native ETH) actually held by the Safe, with live balances. */
export async function fetchSafeTokens(safeAddress: string, chainId: number): Promise<SafeToken[]> {
  const tx = safeTxService(chainId);
  try {
    const safe = getAddress(safeAddress);
    // trusted=true → only tokens on the Safe's curated list (filters spam/scam
    // airdrops). Native ETH is always returned regardless.
    const r = await fetch(`${tx}/api/v1/safes/${safe}/balances/?trusted=true`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return [];
    const arr = (await r.json()) as { tokenAddress: string | null; token: { symbol?: string; decimals?: number } | null; balance: string }[];
    const STABLES = new Set(["USDC", "USDT", "DAI", "USDBC", "EURC", "USDS"]);
    // Stablecoins first, then native ETH, then the rest — so the canonical bounty
    // currency leads and the default selection is meaningful (not ETH dust hiding
    // a real USDC balance, e.g. nogenta's Safe holding 1 USDC + ~0 ETH).
    const rank = (t: SafeToken) => (STABLES.has(t.symbol.toUpperCase()) ? 0 : t.address === null ? 1 : 2);
    return arr
      .map((b): SafeToken => {
        const decimals = b.token?.decimals ?? 18;
        return {
          address: b.tokenAddress ? getAddress(b.tokenAddress) : null,
          symbol: b.token?.symbol ?? "ETH",
          decimals,
          balance: formatUnits(BigInt(b.balance), decimals),
        };
      })
      .filter((t) => Number(t.balance) > 0)
      .sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
  } catch {
    return [];
  }
}

export type SafeTxView = {
  safeTxHash: string;
  nonce: number;
  to: string;
  /** Human label of what the tx does (decoded). */
  action: string;
  executed: boolean;
  success: boolean | null;
  confirmations: number;
  required: number;
  submissionDate: string | null;
  executionTxHash: string | null;
};

export type SafeActivity = {
  isSafe: boolean;
  threshold: number;
  nonce: number;
  queued: SafeTxView[];
  history: SafeTxView[];
};

type RawMultisigTx = {
  safeTxHash: string;
  nonce: number;
  to: string;
  value: string;
  data: string | null;
  isExecuted: boolean;
  isSuccessful: boolean | null;
  submissionDate: string | null;
  transactionHash: string | null;
  confirmations?: unknown[];
  confirmationsRequired: number;
  dataDecoded?: { method?: string; parameters?: { name: string; value: string }[] } | null;
};

function describe(t: RawMultisigTx): string {
  const valEth = Number(formatUnits(BigInt(t.value || "0"), 18));
  if (t.dataDecoded?.method) {
    const m = t.dataDecoded.method;
    if (m === "transfer") {
      const to = t.dataDecoded.parameters?.[0]?.value;
      return `transfer → ${to ? to.slice(0, 8) + "…" : "?"}`;
    }
    return m;
  }
  if (valEth > 0) return `${valEth} ETH → ${t.to.slice(0, 8)}…`;
  return "contract call";
}

function view(t: RawMultisigTx): SafeTxView {
  return {
    safeTxHash: t.safeTxHash,
    nonce: t.nonce,
    to: t.to,
    action: describe(t),
    executed: t.isExecuted,
    success: t.isSuccessful,
    confirmations: (t.confirmations ?? []).length,
    required: t.confirmationsRequired,
    submissionDate: t.submissionDate,
    executionTxHash: t.transactionHash,
  };
}

/** Pending (queued) + recent executed multisig transactions for a Safe. */
export async function fetchSafeActivity(safeAddress: string, chainId: number): Promise<SafeActivity> {
  const tx = safeTxService(chainId);
  const empty: SafeActivity = { isSafe: false, threshold: 0, nonce: 0, queued: [], history: [] };
  try {
    const safe = getAddress(safeAddress);
    const get = async (url: string) => {
      const r = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
      return r.ok ? r.json() : null;
    };
    const info = await get(`${tx}/api/v1/safes/${safe}/`);
    if (!info) return empty;
    const [q, h] = await Promise.all([
      get(`${tx}/api/v1/safes/${safe}/multisig-transactions/?executed=false&ordering=-nonce&limit=10`),
      get(`${tx}/api/v1/safes/${safe}/multisig-transactions/?executed=true&ordering=-nonce&limit=8`),
    ]);
    return {
      isSafe: true,
      threshold: Number(info.threshold ?? 0),
      nonce: Number(info.nonce ?? 0),
      queued: ((q?.results ?? []) as RawMultisigTx[]).map(view),
      history: ((h?.results ?? []) as RawMultisigTx[]).map(view),
    };
  } catch {
    return empty;
  }
}
