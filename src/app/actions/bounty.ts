"use server";

import { cookies } from "next/headers";
import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  getAddress,
  erc20Abi,
  encodeFunctionData,
  hashTypedData,
  zeroAddress,
} from "viem";
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

/** The proposer local account (a delegate on each Safe). Never leaves the server. */
function proposerAccount() {
  const pk = process.env.SAFE_PROPOSER_PRIVATE_KEY?.trim();
  if (!pk) return null;
  try {
    return privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  } catch {
    return null;
  }
}

/** Proposer address derived from SAFE_PROPOSER_PRIVATE_KEY (a delegate on each Safe). */
function proposerAddress(): string | null {
  return proposerAccount()?.address ?? null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Bounties: a Kanban task with a payout reserved from the project's Safe.
// ─────────────────────────────────────────────────────────────────────────────

export type BountyDTO = {
  id: string;
  projectSlug: string;
  taskKey: string;
  title: string;
  amount: string;
  tokenSymbol: string;
  status: string; // open | proposed | paid | cancelled
  payeeAddress: string | null;
  safeTxHash: string | null;
};

function toDTO(b: {
  id: string; projectSlug: string; taskKey: string; title: string; amount: string;
  tokenSymbol: string; status: string; payeeAddress: string | null; safeTxHash: string | null;
}): BountyDTO {
  return { id: b.id, projectSlug: b.projectSlug, taskKey: b.taskKey, title: b.title, amount: b.amount, tokenSymbol: b.tokenSymbol, status: b.status, payeeAddress: b.payeeAddress, safeTxHash: b.safeTxHash };
}

/** Bounties visible on the aggregated Kanban — any authorized SOPA member can see the badges. */
export async function listBounties(): Promise<{ ok: true; bounties: BountyDTO[] } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false, error: "Unauthorized." };
  const rows = await prisma.bounty.findMany({ where: { status: { not: "cancelled" } } }).catch(() => []);
  return { ok: true, bounties: rows.map(toDTO) };
}

/** Reserve a bounty on a task. Checks the amount fits the Safe's available balance. */
export async function createBounty(input: {
  projectSlug: string;
  taskKey: string;
  title: string;
  amount: string;
}): Promise<{ ok: true; bounty: BountyDTO } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  if (!validSlug(input.projectSlug)) return { ok: false, error: "Portal inválido." };
  const taskKey = input.taskKey.trim();
  if (!taskKey) return { ok: false, error: "Tarefa inválida." };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Valor inválido." };

  const config = await prisma.bountyConfig.findUnique({ where: { projectSlug: input.projectSlug } });
  if (!config) return { ok: false, error: "Configure o Safe deste projeto em Settings → Bounties primeiro." };

  const existing = await prisma.bounty.findUnique({ where: { projectSlug_taskKey: { projectSlug: input.projectSlug, taskKey } } });
  if (existing && existing.status !== "cancelled") {
    return { ok: false, error: "Essa tarefa já tem um bounty." };
  }

  // Available = on-chain balance − everything already reserved (open/proposed) for this project.
  const st = await safeStatus(
    { safeAddress: config.safeAddress, chainId: config.chainId, tokenAddress: config.tokenAddress, tokenSymbol: config.tokenSymbol, tokenDecimals: config.tokenDecimals },
    null,
  );
  if (st.balance != null) {
    // amount is a string column (no float drift in DB) — sum reserved in JS.
    const open = await prisma.bounty.findMany({ where: { projectSlug: input.projectSlug, status: { in: ["open", "proposed"] } }, select: { amount: true } });
    const reservedSum = open.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (reservedSum + amount > Number(st.balance) + 1e-9) {
      return { ok: false, error: `Saldo insuficiente: ${st.balance} ${config.tokenSymbol} disponível, ${reservedSum} já reservado.` };
    }
  }

  const row = existing
    ? await prisma.bounty.update({ where: { id: existing.id }, data: { title: input.title.slice(0, 300), amount: String(amount), tokenSymbol: config.tokenSymbol, status: "open", payeeAddress: null, safeTxHash: null, createdBy: g.who.username } })
    : await prisma.bounty.create({ data: { projectSlug: input.projectSlug, taskKey, title: input.title.slice(0, 300), amount: String(amount), tokenSymbol: config.tokenSymbol, status: "open", createdBy: g.who.username } });
  return { ok: true, bounty: toDTO(row) };
}

export async function cancelBounty(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const b = await prisma.bounty.findUnique({ where: { id } });
  if (!b) return { ok: false, error: "Bounty não encontrado." };
  if (b.status === "paid") return { ok: false, error: "Bounty já pago não pode ser cancelado." };
  await prisma.bounty.update({ where: { id }, data: { status: "cancelled" } });
  return { ok: true };
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
  } catch { /* fall through */ }
  let queued = -1;
  try {
    const r = await fetch(`${tx}/api/v1/safes/${safe}/multisig-transactions/?ordering=-nonce&limit=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { results?: { nonce?: number | string }[] };
    if (j.results?.[0]?.nonce != null) queued = Number(j.results[0].nonce);
  } catch { /* fall through */ }
  return Math.max(onchain, queued + 1);
}

/**
 * Propose the payout for a completed bounty to the project's Safe. Builds an
 * ETH or ERC-20 transfer, signs the safeTxHash with the proposer (delegate) and
 * POSTs it to the Safe Transaction Service for the owners to approve & execute.
 */
export async function proposeBountyPayment(id: string, payeeInput: string): Promise<
  { ok: true; safeTxHash: string; url: string } | { ok: false; error: string }
> {
  const g = await globalGate();
  if (!g.ok) return g;

  let payee: `0x${string}`;
  try { payee = getAddress(payeeInput.trim()); } catch { return { ok: false, error: "Endereço de pagamento inválido (0x…)." }; }

  const b = await prisma.bounty.findUnique({ where: { id } });
  if (!b) return { ok: false, error: "Bounty não encontrado." };
  if (b.status === "paid") return { ok: false, error: "Bounty já pago." };
  if (b.status === "proposed") return { ok: false, error: "Pagamento já proposto no Safe." };

  const config = await prisma.bountyConfig.findUnique({ where: { projectSlug: b.projectSlug } });
  if (!config) return { ok: false, error: "Safe do projeto não configurado." };

  const account = proposerAccount();
  if (!account) return { ok: false, error: "SAFE_PROPOSER_PRIVATE_KEY não configurado." };

  const { tx } = chainInfo(config.chainId);
  const safe = getAddress(config.safeAddress);
  const amountUnits = parseUnits(b.amount, config.tokenDecimals);

  // ETH transfer vs ERC-20 transfer(payee, amount).
  let to: `0x${string}`;
  let value: bigint;
  let data: `0x${string}`;
  if (config.tokenAddress) {
    to = getAddress(config.tokenAddress);
    value = BigInt(0);
    data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payee, amountUnits] });
  } else {
    to = payee;
    value = amountUnits;
    data = "0x";
  }

  try {
    const nonce = await nextSafeNonce(tx, safe);
    const message = {
      to,
      value,
      data,
      operation: 0,
      safeTxGas: BigInt(0),
      baseGas: BigInt(0),
      gasPrice: BigInt(0),
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: BigInt(nonce),
    } as const;
    const domain = { chainId: config.chainId, verifyingContract: safe } as const;
    const safeTxHash = hashTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message });
    const signature = await account.signTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message });

    const res = await fetch(`${tx}/api/v1/safes/${safe}/multisig-transactions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        to,
        value: value.toString(),
        data: data === "0x" ? null : data,
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
        origin: `Portal bounty: ${b.title.slice(0, 80)}`,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Safe API HTTP ${res.status}: ${body.slice(0, 220)}` };
    }

    await prisma.bounty.update({ where: { id }, data: { status: "proposed", payeeAddress: payee, safeTxHash } });
    const appUrl = `https://app.safe.global/transactions/queue?safe=${config.chainId === 1 ? "eth" : "base"}:${safe}`;
    return { ok: true, safeTxHash, url: appUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao propor pagamento." };
  }
}
