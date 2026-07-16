import "server-only";
import { getAddress, hashTypedData, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { safeTxService } from "@/lib/safe-tx";

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

/** Next safe nonce = max(on-chain nonce, highest queued nonce + 1) to avoid collisions. */
async function nextSafeNonce(tx: string, safe: string): Promise<number> {
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

  try {
    const nonce = await nextSafeNonce(tx, safe);
    const message = {
      to,
      value,
      data: args.data,
      operation: 0,
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
        operation: 0,
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
