"use server";

import { cookies } from "next/headers";
import { createPublicClient, http, formatUnits, getAddress, erc20Abi } from "viem";
import { base, mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";

function chainInfo(chainId: number) {
  if (chainId === 1) return { chain: mainnet, tx: "https://safe-transaction-mainnet.safe.global" };
  return { chain: base, tx: "https://safe-transaction-base.safe.global" }; // default Base (8453)
}

/** The proposer address derived from SAFE_PROPOSER_PRIVATE_KEY (must be a Safe delegate). */
function proposerAddress(): string | null {
  const pk = process.env.SAFE_PROPOSER_PRIVATE_KEY?.trim();
  if (!pk) return null;
  try {
    return privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`).address;
  } catch {
    return null;
  }
}

async function adminGate() {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  if (who.role !== "admin") return { ok: false as const, error: "Apenas admins." };
  return { ok: true as const, project, who };
}

export type BountySetup = {
  config: { safeAddress: string; chainId: number; tokenAddress: string | null; tokenSymbol: string; tokenDecimals: number } | null;
  proposer: string | null;
  balance: string | null;
  delegateRegistered: boolean | null;
  txServiceChainOk: boolean;
};

/** Everything the Settings panel needs to show the bounty/Safe setup state. */
export async function getBountySetup(): Promise<{ ok: true; setup: BountySetup } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  const row = await prisma.bountyConfig.findUnique({ where: { projectSlug: g.project.slug } }).catch(() => null);
  const proposer = proposerAddress();
  const config = row
    ? { safeAddress: row.safeAddress, chainId: row.chainId, tokenAddress: row.tokenAddress, tokenSymbol: row.tokenSymbol, tokenDecimals: row.tokenDecimals }
    : null;

  let balance: string | null = null;
  let delegateRegistered: boolean | null = null;
  if (config?.safeAddress) {
    const { chain, tx } = chainInfo(config.chainId);
    try {
      const client = createPublicClient({ chain, transport: http() });
      const safe = getAddress(config.safeAddress);
      if (config.tokenAddress) {
        const raw = await client.readContract({ address: getAddress(config.tokenAddress), abi: erc20Abi, functionName: "balanceOf", args: [safe] });
        balance = formatUnits(raw as bigint, config.tokenDecimals);
      } else {
        balance = formatUnits(await client.getBalance({ address: safe }), 18);
      }
    } catch {
      balance = null;
    }
    if (proposer) {
      try {
        const res = await fetch(`${tx}/api/v2/delegates/?safe=${getAddress(config.safeAddress)}&delegate=${getAddress(proposer)}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        const j = (await res.json()) as { count?: number; results?: unknown[] };
        delegateRegistered = (j.count ?? j.results?.length ?? 0) > 0;
      } catch {
        delegateRegistered = null;
      }
    }
  }
  return { ok: true, setup: { config, proposer, balance, delegateRegistered, txServiceChainOk: true } };
}

export async function saveBountyConfig(input: {
  safeAddress: string;
  chainId: number;
  tokenAddress: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  let safe: string;
  try {
    safe = getAddress(input.safeAddress.trim());
  } catch {
    return { ok: false, error: "Endereço do Safe inválido." };
  }
  let token: string | null = null;
  if (input.tokenAddress?.trim()) {
    try {
      token = getAddress(input.tokenAddress.trim());
    } catch {
      return { ok: false, error: "Endereço do token inválido." };
    }
  }
  await prisma.bountyConfig.upsert({
    where: { projectSlug: g.project.slug },
    update: { safeAddress: safe, chainId: input.chainId, tokenAddress: token, tokenSymbol: input.tokenSymbol.trim() || "ETH", tokenDecimals: input.tokenDecimals, updatedBy: g.who.username },
    create: { projectSlug: g.project.slug, safeAddress: safe, chainId: input.chainId, tokenAddress: token, tokenSymbol: input.tokenSymbol.trim() || "ETH", tokenDecimals: input.tokenDecimals, updatedBy: g.who.username },
  });
  return { ok: true };
}

/** The EIP-712 typed data the owner signs to register the proposer as a delegate. */
export async function getDelegateSignPayload(): Promise<
  { ok: true; domain: object; types: object; message: object; primaryType: string; delegate: string } | { ok: false; error: string }
> {
  const g = await adminGate();
  if (!g.ok) return g;
  const row = await prisma.bountyConfig.findUnique({ where: { projectSlug: g.project.slug } });
  const proposer = proposerAddress();
  if (!row || !proposer) return { ok: false, error: "Configure o Safe e o proposer primeiro." };
  const totp = Math.floor(Date.now() / 1000 / 3600);
  return {
    ok: true,
    delegate: proposer,
    primaryType: "Delegate",
    domain: { name: "Safe Transaction Service", version: "1.0", chainId: row.chainId },
    types: { Delegate: [{ name: "delegateAddress", type: "address" }, { name: "totp", type: "uint256" }] },
    message: { delegateAddress: getAddress(proposer), totp },
  };
}

/** Register the proposer as a delegate, using the owner's EIP-712 signature. */
export async function registerDelegate(delegator: string, signature: string, label = "Portal bounty proposer"): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  const row = await prisma.bountyConfig.findUnique({ where: { projectSlug: g.project.slug } });
  const proposer = proposerAddress();
  if (!row || !proposer) return { ok: false, error: "Configure o Safe e o proposer primeiro." };
  const { tx } = chainInfo(row.chainId);
  try {
    const res = await fetch(`${tx}/api/v2/delegates/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ safe: getAddress(row.safeAddress), delegate: getAddress(proposer), delegator: getAddress(delegator), signature, label }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Safe API HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao registrar delegate." };
  }
}
