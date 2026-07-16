"use server";

import { cookies } from "next/headers";
import { encodeFunctionData, getAddress } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { proposeSafeTx, proposerAddress } from "@/lib/safe-propose";
import { SUPERFLUID, SOPA_SAFE, findSopaPool } from "@/lib/superfluid";

// GDAv1Forwarder.createPool(token, admin, PoolConfig{transferabilityForUnitsOwner, distributionFromAnyAddress})
const GDA_ABI = [
  {
    name: "createPool",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "admin", type: "address" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "transferabilityForUnitsOwner", type: "bool" },
          { name: "distributionFromAnyAddress", type: "bool" },
        ],
      },
    ],
    outputs: [
      { name: "success", type: "bool" },
      { name: "pool", type: "address" },
    ],
  },
] as const;

async function gate() {
  const project = await getActiveProject();
  if (project.slug !== "sopa") return { ok: false as const, error: "Stream é só da SOPA." };
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, username: session.username };
}

/**
 * Propose creating the SOPA payroll distribution pool (GDA) on Base, with the
 * SOPA Safe as admin. The proposer signs; owners approve + execute in Safe.
 * Idempotent-ish: refuses if a pool already exists for the Safe.
 */
export async function proposeCreatePool(): Promise<
  { ok: true; safeTxHash: string; url: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  if (!proposerAddress()) return { ok: false, error: "Proposer (SAFE_PROPOSER_PRIVATE_KEY) não configurado." };

  try {
    const existing = await findSopaPool();
    if (existing) return { ok: false, error: "Já existe uma pool para este Safe." };

    const data = encodeFunctionData({
      abi: GDA_ABI,
      functionName: "createPool",
      // getAddress → checksummed; viem rejects non-checksummed address args.
      args: [
        getAddress(SUPERFLUID.usdcx),
        getAddress(SOPA_SAFE),
        { transferabilityForUnitsOwner: false, distributionFromAnyAddress: false },
      ],
    });

    return await proposeSafeTx({
      chainId: SUPERFLUID.chainId,
      safe: SOPA_SAFE,
      to: SUPERFLUID.gdaForwarder,
      data,
      origin: "SOPA: criar pool de payroll (Superfluid GDA)",
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor a pool." };
  }
}
