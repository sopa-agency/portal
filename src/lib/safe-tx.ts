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
    const r = await fetch(`${tx}/api/v1/safes/${safe}/balances/?trusted=false`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return [];
    const arr = (await r.json()) as { tokenAddress: string | null; token: { symbol?: string; decimals?: number } | null; balance: string }[];
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
      .filter((t) => Number(t.balance) > 0);
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
