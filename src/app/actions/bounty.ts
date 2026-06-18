"use server";

import { cookies } from "next/headers";
import { createPublicClient, http, formatUnits, getAddress, erc20Abi } from "viem";
import { base, mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject, getAllProjects } from "@/projects/index";
import { prisma } from "@/lib/prisma";

function chainInfo(chainId: number) {
  if (chainId === 1) return { chain: mainnet, tx: "https://safe-transaction-mainnet.safe.global" };
  return { chain: base, tx: "https://safe-transaction-base.safe.global" }; // default Base (8453)
}

/** Proposer address derived from SAFE_PROPOSER_PRIVATE_KEY (a delegate on each Safe). */
function proposerAddress(): string | null {
  const pk = process.env.SAFE_PROPOSER_PRIVATE_KEY?.trim();
  if (!pk) return null;
  try {
    return privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`).address;
  } catch {
    return null;
  }
}

// Cross-project bounty setup is managed by global admins (the SOPA hub).
async function globalGate() {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  if (!who.global) return { ok: false as const, error: "Apenas admins globais gerenciam bounties." };
  return { ok: true as const, who };
}

type BountyConfigDTO = { safeAddress: string; chainId: number; tokenAddress: string | null; tokenSymbol: string; tokenDecimals: number };
export type ProjectBounty = {
  slug: string;
  name: string;
  config: BountyConfigDTO | null;
  balance: string | null;
  delegateRegistered: boolean | null;
};

async function safeStatus(config: BountyConfigDTO, proposer: string | null): Promise<{ balance: string | null; delegate: boolean | null }> {
  const { chain, tx } = chainInfo(config.chainId);
  let balance: string | null = null;
  let delegate: boolean | null = null;
  try {
    const client = createPublicClient({ chain, transport: http() });
    const safe = getAddress(config.safeAddress);
    if (config.tokenAddress) {
      const raw = (await client.readContract({ address: getAddress(config.tokenAddress), abi: erc20Abi, functionName: "balanceOf", args: [safe] })) as bigint;
      balance = formatUnits(raw, config.tokenDecimals);
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
      delegate = (j.count ?? j.results?.length ?? 0) > 0;
    } catch {
      delegate = null;
    }
  }
  return { balance, delegate };
}

/** Per-project bounty setup (Safe/token/delegate) for every portal. */
export async function getBountySetup(): Promise<{ ok: true; proposer: string | null; projects: ProjectBounty[] } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const proposer = proposerAddress();
  const rows = await prisma.bountyConfig.findMany().catch(() => []);
  const byProject = new Map(rows.map((r) => [r.projectSlug, r]));
  const projects = await Promise.all(
    getAllProjects().map(async (p): Promise<ProjectBounty> => {
      const row = byProject.get(p.slug);
      const config: BountyConfigDTO | null = row
        ? { safeAddress: row.safeAddress, chainId: row.chainId, tokenAddress: row.tokenAddress, tokenSymbol: row.tokenSymbol, tokenDecimals: row.tokenDecimals }
        : null;
      if (!config) return { slug: p.slug, name: p.name, config: null, balance: null, delegateRegistered: null };
      const st = await safeStatus(config, proposer);
      return { slug: p.slug, name: p.name, config, balance: st.balance, delegateRegistered: st.delegate };
    }),
  );
  return { ok: true, proposer, projects };
}

function validSlug(slug: string): boolean {
  return getAllProjects().some((p) => p.slug === slug);
}

export async function saveBountyConfig(projectSlug: string, input: {
  safeAddress: string;
  chainId: number;
  tokenAddress: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  if (!validSlug(projectSlug)) return { ok: false, error: "Portal inválido." };
  let safe: string;
  try {
    safe = getAddress(input.safeAddress.trim());
  } catch {
    return { ok: false, error: "Endereço do Safe inválido." };
  }
  let token: string | null = null;
  if (input.tokenAddress?.trim()) {
    try { token = getAddress(input.tokenAddress.trim()); } catch { return { ok: false, error: "Endereço do token inválido." }; }
  }
  await prisma.bountyConfig.upsert({
    where: { projectSlug },
    update: { safeAddress: safe, chainId: input.chainId, tokenAddress: token, tokenSymbol: input.tokenSymbol.trim() || "ETH", tokenDecimals: input.tokenDecimals, updatedBy: g.who.username },
    create: { projectSlug, safeAddress: safe, chainId: input.chainId, tokenAddress: token, tokenSymbol: input.tokenSymbol.trim() || "ETH", tokenDecimals: input.tokenDecimals, updatedBy: g.who.username },
  });
  return { ok: true };
}

/** EIP-712 typed data an owner signs to register the proposer as a delegate on a project's Safe. */
export async function getDelegateSignPayload(projectSlug: string): Promise<
  { ok: true; domain: object; types: object; message: object; primaryType: string; delegate: string } | { ok: false; error: string }
> {
  const g = await globalGate();
  if (!g.ok) return g;
  const row = await prisma.bountyConfig.findUnique({ where: { projectSlug } });
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

/** Register the proposer as a delegate on a project's Safe (owner EIP-712 signature). */
export async function registerDelegate(projectSlug: string, delegator: string, signature: string, label = "Portal bounty proposer"): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const row = await prisma.bountyConfig.findUnique({ where: { projectSlug } });
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
