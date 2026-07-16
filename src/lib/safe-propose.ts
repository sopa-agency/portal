import "server-only";
import { getAddress, hashTypedData, zeroAddress, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { safeTxService } from "@/lib/safe-tx";

// MultiSendCallOnly 1.4.1 (canonical, and already used by the SOPA Safe at
// setup). Lets us batch N calls into ONE Safe proposal (operation = delegatecall).
const MULTISEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
const MULTISEND_ABI = [
  { name: "multiSend", type: "function", stateMutability: "payable", inputs: [{ name: "transactions", type: "bytes" }], outputs: [] },
] as const;

export type SafeCall = { to: string; data: `0x${string}`; value?: bigint };

/** Pack calls into MultiSend's `transactions` bytes: per call operation(0)+to+value+len+data. */
function encodeMultiSend(calls: SafeCall[]): `0x${string}` {
  const parts = calls.map((c) => {
    const to = getAddress(c.to).slice(2).toLowerCase();
    const value = (c.value ?? BigInt(0)).toString(16).padStart(64, "0");
    const data = (c.data || "0x").slice(2);
    const len = (data.length / 2).toString(16).padStart(64, "0");
    return `00${to}${value}${len}${data}`; // 00 = CALL
  });
  return `0x${parts.join("")}`;
}

// Server-side Safe transaction proposer. The SAFE_PROPOSER_PRIVATE_KEY account
// (a delegate on the Safe) signs the safeTxHash and POSTs it to the Safe
// Transaction Service; the Safe owners then approve + execute in Safe{Wallet}.
// Same mechanism the bounty payouts use — no funds move without owner signatures.

export function proposerAccount() {
  const pk = process.env.SAFE_PROPOSER_PRIVATE_KEY?.trim();
  if (!pk) return null;
  try {
    return privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  } catch {
    return null;
  }
}

export function proposerAddress(): string | null {
  return proposerAccount()?.address ?? null;
}

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** Next safe nonce = max(on-chain nonce, highest queued nonce + 1) to avoid
 *  collisions. Exported so callers can sequence a multi-tx flow (approve→deposit)
 *  at nonce, nonce+1, … in guaranteed execution order. */
export async function nextSafeNonce(chainId: number, safeAddr: string): Promise<number> {
  const tx = safeTxService(chainId);
  const safe = getAddress(safeAddr);
  let onchain = 0;
  try {
    const r = await fetch(`${tx}/api/v1/safes/${safe}/`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { nonce?: number | string };
    onchain = Number(j.nonce ?? 0) || 0;
  } catch {
    /* fall through */
  }
  let queued = -1;
  try {
    const r = await fetch(`${tx}/api/v1/safes/${safe}/multisig-transactions/?ordering=-nonce&limit=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { results?: { nonce?: number | string }[] };
    if (j.results?.[0]?.nonce != null) queued = Number(j.results[0].nonce);
  } catch {
    /* fall through */
  }
  return Math.max(onchain, queued + 1);
}

const queueUrl = (chainId: number, safe: string) =>
  `https://app.safe.global/transactions/queue?safe=${chainId === 1 ? "eth" : "base"}:${safe}`;

/**
 * Build, sign (proposer) and POST a single Safe transaction to the tx service.
 * Owners approve + execute it in Safe{Wallet}. `data` is the encoded call.
 */
export async function proposeSafeTx(args: {
  chainId: number;
  safe: string;
  to: string;
  data: `0x${string}`;
  value?: bigint;
  origin?: string;
  /** Explicit nonce (to sequence a multi-tx flow); computed if omitted. */
  nonce?: number;
  /** 0 = CALL (default), 1 = DELEGATECALL (MultiSend batches). */
  operation?: 0 | 1;
}): Promise<{ ok: true; safeTxHash: string; url: string } | { ok: false; error: string }> {
  const account = proposerAccount();
  if (!account) return { ok: false, error: "SAFE_PROPOSER_PRIVATE_KEY não configurado." };

  let safe: `0x${string}`;
  let to: `0x${string}`;
  try {
    safe = getAddress(args.safe);
    to = getAddress(args.to);
  } catch {
    return { ok: false, error: "Endereço inválido." };
  }
  const tx = safeTxService(args.chainId);
  const value = args.value ?? BigInt(0);
  const operation = args.operation ?? 0;

  try {
    const nonce = args.nonce ?? (await nextSafeNonce(args.chainId, safe));
    const message = {
      to,
      value,
      data: args.data,
      operation,
      safeTxGas: BigInt(0),
      baseGas: BigInt(0),
      gasPrice: BigInt(0),
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: BigInt(nonce),
    } as const;
    const domain = { chainId: args.chainId, verifyingContract: safe } as const;
    const safeTxHash = hashTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message });
    const signature = await account.signTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message });

    const res = await fetch(`${tx}/api/v1/safes/${safe}/multisig-transactions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        to,
        value: value.toString(),
        data: args.data,
        operation,
        safeTxGas: "0",
        baseGas: "0",
        gasPrice: "0",
        gasToken: zeroAddress,
        refundReceiver: zeroAddress,
        nonce,
        contractTransactionHash: safeTxHash,
        sender: account.address,
        signature,
        origin: args.origin?.slice(0, 100) ?? "SOPA portal",
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Safe API HTTP ${res.status}: ${body.slice(0, 220)}` };
    }
    return { ok: true, safeTxHash, url: queueUrl(args.chainId, safe) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao propor transação." };
  }
}

/**
 * Propose several calls as ONE Safe transaction via MultiSendCallOnly — so an
 * action (approve+deposit, N updateMemberUnits) is a single queue entry / one
 * signing round instead of piling up. Falls back to a plain tx for a single call.
 */
export async function proposeSafeBatch(args: {
  chainId: number;
  safe: string;
  calls: SafeCall[];
  origin?: string;
  nonce?: number;
}): Promise<{ ok: true; safeTxHash: string; url: string } | { ok: false; error: string }> {
  if (args.calls.length === 0) return { ok: false, error: "Nada para propor." };
  if (args.calls.length === 1) {
    const c = args.calls[0];
    return proposeSafeTx({ chainId: args.chainId, safe: args.safe, to: c.to, data: c.data, value: c.value, origin: args.origin, nonce: args.nonce });
  }
  const data = encodeFunctionData({ abi: MULTISEND_ABI, functionName: "multiSend", args: [encodeMultiSend(args.calls)] });
  return proposeSafeTx({
    chainId: args.chainId,
    safe: args.safe,
    to: MULTISEND_CALL_ONLY,
    data,
    operation: 1, // delegatecall into MultiSend
    origin: args.origin,
    nonce: args.nonce,
  });
}
