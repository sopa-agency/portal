"use server";

import { cookies } from "next/headers";
import { encodeFunctionData, getAddress, parseUnits, erc20Abi } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { proposeSafeTx, proposeSafeBatch, proposerAddress } from "@/lib/safe-propose";
import { SOPA_SAFE } from "@/lib/superfluid";
import { MORPHO } from "@/lib/staking";

// ERC-4626 subset — deposit(assets, receiver) / withdraw(assets, receiver, owner).
const VAULT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function gate() {
  const project = await getActiveProject();
  if (project.slug !== "sopa") return { ok: false as const, error: "Staking é só da SOPA." };
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Não autorizado." };
  if (!proposerAddress()) return { ok: false as const, error: "Proposer não configurado." };
  return { ok: true as const };
}

function parseAmount(input: string): bigint | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return parseUnits(input.trim(), MORPHO.usdcDecimals);
  } catch {
    return null;
  }
}

/** Propose staking USDC into the Morpho vault: approve + deposit, as two Safe
 *  txs at consecutive nonces (execute in order → one signing round). */
export async function proposeStake(amount: string): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const assets = parseAmount(amount);
  if (assets == null) return { ok: false, error: "Valor inválido." };
  try {
    const safe = getAddress(SOPA_SAFE);
    const vault = getAddress(MORPHO.vault);
    return await proposeSafeBatch({
      chainId: MORPHO.chainId,
      safe,
      origin: "SOPA: stakar USDC no Morpho (approve + deposit)",
      calls: [
        { to: getAddress(MORPHO.usdc), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, assets] }) },
        { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [assets, safe] }) },
      ],
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor stake." };
  }
}

/** Propose withdrawing USDC from the Morpho vault back to the Safe. */
export async function proposeUnstake(amount: string): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const assets = parseAmount(amount);
  if (assets == null) return { ok: false, error: "Valor inválido." };
  try {
    const safe = getAddress(SOPA_SAFE);
    return await proposeSafeTx({
      chainId: MORPHO.chainId,
      safe,
      to: getAddress(MORPHO.vault),
      data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [assets, safe, safe] }),
      origin: "SOPA: sacar USDC do Morpho",
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor saque." };
  }
}
