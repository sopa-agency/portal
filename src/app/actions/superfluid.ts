"use server";

import { cookies } from "next/headers";
import { encodeFunctionData, getAddress, parseUnits, erc20Abi } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { proposeSafeTx, nextSafeNonce, proposerAddress } from "@/lib/safe-propose";
import { SUPERFLUID, SOPA_SAFE, findSopaPool } from "@/lib/superfluid";

const SECONDS_PER_MONTH = 2_592_000;

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
  {
    name: "updateMemberUnits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "member", type: "address" },
      { name: "newUnits", type: "uint128" },
      { name: "userData", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "distributeFlow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "from", type: "address" },
      { name: "pool", type: "address" },
      { name: "requestedFlowRate", type: "int96" },
      { name: "userData", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// SuperToken.upgrade(uint256) — wrap underlying USDC into USDCx (18-dec arg).
const SUPERTOKEN_ABI = [
  { name: "upgrade", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
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

/**
 * Push the portal's active payroll units onto the pool (one updateMemberUnits
 * per member, sequential nonces → one signing round). The pool must exist.
 */
export async function proposeSetUnits(): Promise<
  { ok: true; url: string; count: number } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  if (!proposerAddress()) return { ok: false, error: "Proposer não configurado." };
  try {
    const pool = await findSopaPool();
    if (!pool) return { ok: false, error: "Crie a pool primeiro." };
    const members = await prisma.payrollMember.findMany({ where: { projectSlug: "sopa", active: true } });
    const valid = members.filter((m) => /^0x[a-fA-F0-9]{40}$/.test(m.address) && m.units > 0);
    if (!valid.length) return { ok: false, error: "Nenhum membro ativo com peso e carteira válida." };

    const safe = getAddress(SOPA_SAFE);
    const poolAddr = getAddress(pool);
    const base = await nextSafeNonce(SUPERFLUID.chainId, safe);
    let url = "";
    for (let i = 0; i < valid.length; i++) {
      const m = valid[i];
      const data = encodeFunctionData({
        abi: GDA_ABI,
        functionName: "updateMemberUnits",
        args: [poolAddr, getAddress(m.address), BigInt(m.units), "0x"],
      });
      const r = await proposeSafeTx({
        chainId: SUPERFLUID.chainId,
        safe,
        to: SUPERFLUID.gdaForwarder,
        data,
        nonce: base + i,
        origin: `SOPA: units ${m.label.slice(0, 40)} = ${m.units}`,
      });
      if (!r.ok) return r;
      url = r.url;
    }
    return { ok: true, url, count: valid.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor units." };
  }
}

/** Wrap USDC → USDCx (approve + upgrade) so the Safe can stream. */
export async function proposeWrap(amount: string): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  if (!proposerAddress()) return { ok: false, error: "Proposer não configurado." };
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Valor inválido." };
  try {
    const safe = getAddress(SOPA_SAFE);
    const usdcx = getAddress(SUPERFLUID.usdcx);
    const amount6 = parseUnits(amount.trim(), 6); // approve on 6-dec USDC
    const amount18 = parseUnits(amount.trim(), 18); // upgrade arg is 18-dec
    const base = await nextSafeNonce(SUPERFLUID.chainId, safe);

    const approve = await proposeSafeTx({
      chainId: SUPERFLUID.chainId,
      safe,
      to: getAddress(SUPERFLUID.usdc),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [usdcx, amount6] }),
      nonce: base,
      origin: "SOPA: aprovar USDC p/ wrap",
    });
    if (!approve.ok) return approve;

    const upgrade = await proposeSafeTx({
      chainId: SUPERFLUID.chainId,
      safe,
      to: usdcx,
      data: encodeFunctionData({ abi: SUPERTOKEN_ABI, functionName: "upgrade", args: [amount18] }),
      nonce: base + 1,
      origin: "SOPA: wrap USDC → USDCx",
    });
    return upgrade.ok ? { ok: true, url: upgrade.url } : upgrade;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor wrap." };
  }
}

/** Start/adjust (monthlyUsd > 0) or stop (0) the streaming distribution to the pool. */
export async function proposeSetFlow(monthlyUsd: string): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  if (!proposerAddress()) return { ok: false, error: "Proposer não configurado." };
  const monthly = Number(monthlyUsd);
  if (!Number.isFinite(monthly) || monthly < 0) return { ok: false, error: "Valor inválido." };
  try {
    const pool = await findSopaPool();
    if (!pool) return { ok: false, error: "Crie a pool primeiro." };
    const safe = getAddress(SOPA_SAFE);
    // int96 wei/sec = USDCx (18-dec) per month ÷ seconds per month.
    const flowRate = monthly === 0 ? BigInt(0) : parseUnits(monthlyUsd.trim(), 18) / BigInt(SECONDS_PER_MONTH);
    const data = encodeFunctionData({
      abi: GDA_ABI,
      functionName: "distributeFlow",
      args: [getAddress(SUPERFLUID.usdcx), safe, getAddress(pool), flowRate, "0x"],
    });
    return await proposeSafeTx({
      chainId: SUPERFLUID.chainId,
      safe,
      to: SUPERFLUID.gdaForwarder,
      data,
      origin: monthly === 0 ? "SOPA: parar stream" : `SOPA: stream $${monthly}/mês`,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor stream." };
  }
}
