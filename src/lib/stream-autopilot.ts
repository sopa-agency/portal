import "server-only";
import { getAddress, encodeFunctionData, parseUnits, erc20Abi } from "viem";
import { proposeSafeBatch, proposerAddress } from "@/lib/safe-propose";
import { safeTxService } from "@/lib/safe-tx";
import { SOPA_SAFE, SUPERFLUID, findSopaPool, getStreamStatus } from "@/lib/superfluid";
import { MORPHO, getStakePosition } from "@/lib/staking";

// The half Auto-Wrap can't do: Auto-Wrap only converts USDC that is ALREADY in
// the Safe — it never withdraws from the vault. So when the stream buffer runs
// low, this proposes the refill (withdraw accrued yield from Morpho + wrap it)
// for the owners to sign. It only ever PROPOSES; nothing moves without them.

/** Refill when the buffer covers fewer days than this. */
const LOW_RUNWAY_DAYS = 14;
/** Target buffer after a refill, in days of stream. */
const TARGET_DAYS = 60;
/** Don't bother proposing below this — gas would dwarf the amount. */
const MIN_REFILL_USD = 5;

const VAULT_ABI = [
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const UPGRADE_ABI = [
  { name: "upgrade", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

/** Is a refill already sitting in the Safe queue? Avoids piling up proposals. */
async function refillAlreadyQueued(): Promise<boolean> {
  try {
    const url = `${safeTxService(SUPERFLUID.chainId)}/api/v1/safes/${getAddress(SOPA_SAFE)}/multisig-transactions/?executed=false&limit=20`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return true; // can't tell → don't risk duplicating
    const json = (await res.json()) as { results?: { origin?: string | null; isExecuted?: boolean }[] };
    return (json.results ?? []).some((t) => !t.isExecuted && (t.origin ?? "").includes("piloto"));
  } catch {
    return true; // on error, stay quiet rather than spam the queue
  }
}

export type AutopilotResult = { ran: boolean; reason: string; proposedUsd?: number };

export async function refillStreamIfLow(): Promise<AutopilotResult> {
  if (!proposerAddress()) return { ran: false, reason: "sem proposer" };
  try {
    const pool = await findSopaPool();
    if (!pool) return { ran: false, reason: "sem pool" };
    const status = await getStreamStatus(pool);
    if (!status || status.flowRatePerSec <= 0) return { ran: false, reason: "stream parado" };
    if (status.runwayDays != null && status.runwayDays > LOW_RUNWAY_DAYS) {
      return { ran: false, reason: `runway ok (${Math.floor(status.runwayDays)}d)` };
    }

    // Refill up to TARGET_DAYS, capped by what the vault actually holds.
    const perDay = status.flowRatePerSec * 86_400;
    const want = Math.max(0, perDay * TARGET_DAYS - status.safeUsdcxUsd);
    const stake = await getStakePosition(SOPA_SAFE);
    const available = stake.valueUsd;
    const amount = Math.min(want, available);
    if (amount < MIN_REFILL_USD) return { ran: false, reason: `refill pequeno demais ($${amount.toFixed(2)})` };
    if (await refillAlreadyQueued()) return { ran: false, reason: "já tem proposta na fila" };

    const value = amount.toFixed(2);
    const safe = getAddress(SOPA_SAFE);
    const assets = parseUnits(value, MORPHO.usdcDecimals);
    const res = await proposeSafeBatch({
      chainId: SUPERFLUID.chainId,
      safe,
      origin: `SOPA piloto: repor reserva do stream (${value} USDC)`,
      calls: [
        { to: getAddress(MORPHO.vault), data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [assets, safe, safe] }) },
        { to: getAddress(MORPHO.usdc), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(SUPERFLUID.usdcx), assets] }) },
        { to: getAddress(SUPERFLUID.usdcx), data: encodeFunctionData({ abi: UPGRADE_ABI, functionName: "upgrade", args: [parseUnits(value, 18)] }) },
      ],
    });
    return res.ok
      ? { ran: true, reason: "proposta de reposição criada", proposedUsd: Number(value) }
      : { ran: false, reason: res.error };
  } catch (e) {
    return { ran: false, reason: String(e).slice(0, 140) };
  }
}
