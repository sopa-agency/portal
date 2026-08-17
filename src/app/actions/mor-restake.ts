"use server";

import { cookies } from "next/headers";
import { createPublicClient, http, fallback, encodeFunctionData, getAddress, erc20Abi } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { proposeSafeBatch, proposerAddress } from "@/lib/safe-propose";
import { SOPA_SAFE } from "@/lib/superfluid";
import { PIPELINE, TOKENS, pipelineAbis, warehouseId } from "@/lib/mor-pipeline";

const BASE = 8453;
const client = createPublicClient({
  transport: fallback(["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].map((u) => http(u))),
});

// BuildersV4.deposit(subnetId, amount) — the exact stake call the working
// SopaStakePanel uses. Approve target is the builders contract itself (NOT a
// separate Distributor — that's the Ethereum Morpheus-Capital track, different).
const buildersDeposit = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "subnetId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/**
 * Propose restaking SOPA's 10% MOR cut into the Gnars Builder subnet as ONE Safe
 * batch: withdraw the Warehouse credit → approve builders → deposit. The MOR is
 * the SOPA Safe's own; the batch lands in the Safe queue for owners to sign. No
 * hot key, no auto-execution — the button just builds + proposes and hands back
 * the Safe signing link.
 */
export async function proposeMorRestake(): Promise<
  { ok: true; url: string; amount: string } | { ok: false; error: string }
> {
  const project = await getActiveProject();
  if (project.slug !== "sopa") return { ok: false, error: "Restake é só da SOPA." };
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Não autorizado." };
  if (!proposerAddress()) return { ok: false, error: "Proposer (SAFE_PROPOSER_PRIVATE_KEY) não configurado." };

  const safe = getAddress(SOPA_SAFE);
  const mor = getAddress(TOKENS.mor.address);
  const builders = getAddress(PIPELINE.builders);
  try {
    // Raw balances (wei) so the tx amount is exact: Warehouse credit + wallet MOR.
    const [whCredit, walletMor] = await Promise.all([
      client.readContract({ address: getAddress(PIPELINE.warehouse), abi: pipelineAbis.warehouse as never, functionName: "balanceOf", args: [safe, warehouseId(mor)] }) as Promise<bigint>,
      client.readContract({ address: mor, abi: pipelineAbis.erc20 as never, functionName: "balanceOf", args: [safe] }) as Promise<bigint>,
    ]);
    const wh = whCredit > BigInt(1) ? whCredit : BigInt(0); // Warehouse leaves 1 wei
    const amount = wh + walletMor;
    if (amount < BigInt("1000000000000000")) return { ok: false, error: "Nada pra restakear (menos de 0,001 MOR na SOPA)." };

    const calls = [
      // Warehouse withdraw is permissionless; batching it means one signature for the whole restake.
      { to: getAddress(PIPELINE.warehouse), data: encodeFunctionData({ abi: pipelineAbis.warehouse, functionName: "withdraw", args: [safe, mor] }) },
      { to: mor, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [builders, amount] }) },
      { to: builders, data: encodeFunctionData({ abi: buildersDeposit, functionName: "deposit", args: [PIPELINE.subnetId, amount] }) },
    ];
    const res = await proposeSafeBatch({ chainId: BASE, safe, origin: "SOPA: restake 10% MOR na subnet (withdraw + approve + deposit)", calls });
    if (!res.ok) return res;
    return { ok: true, url: res.url, amount: (Number(amount) / 1e18).toFixed(4) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor restake." };
  }
}
