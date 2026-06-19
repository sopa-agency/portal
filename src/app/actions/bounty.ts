"use server";

import { cookies } from "next/headers";
import {
  parseUnits,
  getAddress,
  erc20Abi,
  encodeFunctionData,
  hashTypedData,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject, getAllProjects } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { fetchSafeTokens, fetchSafeInfo, safeTxService } from "@/lib/safe-tx";

/** Chains a project's Safe can be used on. Same address is probed on each. */
const SUPPORTED_CHAINS: { chainId: number; name: string }[] = [
  { chainId: 8453, name: "Base" },
  { chainId: 1, name: "Ethereum" },
];
const tokenKey = (addr: string | null) => (addr ? addr.toLowerCase() : "eth");

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

/** Per-chain status of a project's Safe (for the Settings overview). */
export type ChainStatus = {
  chainId: number;
  name: string;
  exists: boolean; // Safe deployed on this chain
  delegate: boolean | null; // proposer registered as delegate here
  balances: string; // short human summary, e.g. "0.001 ETH · 16 USDC"
};
export type ProjectBounty = {
  slug: string;
  name: string;
  safeAddress: string | null;
  chains: ChainStatus[];
};

/** Is the proposer a registered delegate of `safe` on `chainId`? */
async function isProposerDelegate(safe: string, chainId: number, proposer: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${safeTxService(chainId)}/api/v2/delegates/?safe=${getAddress(safe)}&delegate=${getAddress(proposer)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json()) as { count?: number; results?: unknown[] };
    return (j.count ?? j.results?.length ?? 0) > 0;
  } catch {
    return null;
  }
}

async function chainStatus(safe: string, chainId: number, name: string, proposer: string | null): Promise<ChainStatus> {
  const info = await fetchSafeInfo(safe, chainId);
  if (!info?.exists) return { chainId, name, exists: false, delegate: null, balances: "" };
  const [delegate, tokens] = await Promise.all([
    proposer ? isProposerDelegate(safe, chainId, proposer) : Promise.resolve(null),
    fetchSafeTokens(safe, chainId),
  ]);
  const balances = tokens.slice(0, 3).map((t) => `${Number(t.balance)} ${t.symbol}`).join(" · ") || "vazio";
  return { chainId, name, exists: true, delegate, balances };
}

/** Per-project bounty setup — the Safe + its status on EVERY supported chain. */
export async function getBountySetup(): Promise<{ ok: true; proposer: string | null; projects: ProjectBounty[] } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const proposer = proposerAddress();
  const rows = await prisma.bountyConfig.findMany().catch(() => []);
  const byProject = new Map(rows.map((r) => [r.projectSlug, r]));
  const projects = await Promise.all(
    getAllProjects().map(async (p): Promise<ProjectBounty> => {
      const row = byProject.get(p.slug);
      if (!row) return { slug: p.slug, name: p.name, safeAddress: null, chains: [] };
      const chains = await Promise.all(SUPPORTED_CHAINS.map((c) => chainStatus(row.safeAddress, c.chainId, c.name, proposer)));
      return { slug: p.slug, name: p.name, safeAddress: row.safeAddress, chains };
    }),
  );
  return { ok: true, proposer, projects };
}

function validSlug(slug: string): boolean {
  return getAllProjects().some((p) => p.slug === slug);
}

/** Save the project's Safe address (same address is used on Base + mainnet). */
export async function saveBountyConfig(projectSlug: string, input: { safeAddress: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  if (!validSlug(projectSlug)) return { ok: false, error: "Portal inválido." };
  let safe: string;
  try {
    safe = getAddress(input.safeAddress.trim());
  } catch {
    return { ok: false, error: "Endereço do Safe inválido." };
  }
  // chainId/token columns are legacy defaults — chain + token are chosen per bounty.
  await prisma.bountyConfig.upsert({
    where: { projectSlug },
    update: { safeAddress: safe, updatedBy: g.who.username },
    create: { projectSlug, safeAddress: safe, chainId: 8453, tokenAddress: null, tokenSymbol: "ETH", tokenDecimals: 18, updatedBy: g.who.username },
  });
  return { ok: true };
}

// Delegate registration is done directly in the Safe{Wallet} UI (app.safe.global);
// the portal only reads delegate status (see safeStatus) to gate proposing.

// ─────────────────────────────────────────────────────────────────────────────
// Bounties: a Kanban task with a payout reserved from the project's Safe.
// ─────────────────────────────────────────────────────────────────────────────

export type BountyDTO = {
  id: string;
  projectSlug: string;
  taskKey: string;
  title: string;
  amount: string;
  chainId: number;
  tokenSymbol: string;
  status: string; // open | proposed | paid | cancelled
  payeeAddress: string | null;
  safeTxHash: string | null;
};

function toDTO(b: {
  id: string; projectSlug: string; taskKey: string; title: string; amount: string;
  chainId: number; tokenSymbol: string; status: string; payeeAddress: string | null; safeTxHash: string | null;
}): BountyDTO {
  return { id: b.id, projectSlug: b.projectSlug, taskKey: b.taskKey, title: b.title, amount: b.amount, chainId: b.chainId, tokenSymbol: b.tokenSymbol, status: b.status, payeeAddress: b.payeeAddress, safeTxHash: b.safeTxHash };
}

/** Bounties visible on the aggregated Kanban — any authorized SOPA member can see the badges. */
export async function listBounties(): Promise<{ ok: true; bounties: BountyDTO[] } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false, error: "Unauthorized." };
  const rows = await prisma.bounty.findMany({ where: { status: { not: "cancelled" } } }).catch(() => []);
  return { ok: true, bounties: rows.map(toDTO) };
}

/** A token the Safe holds + how much is still un-reserved for new bounties. */
export type SafeTokenAvailability = { address: string | null; symbol: string; decimals: number; balance: string; available: string };
/** A chain a project's Safe is usable on (deployed + proposer is delegate), with its tokens. */
export type SafeChainOption = { chainId: number; name: string; tokens: SafeTokenAvailability[] };

/** Available per token = held − reserved (open/proposed bounties on the SAME chain+token). */
function withAvailability(held: { address: string | null; symbol: string; decimals: number; balance: string }[], reservedByToken: Map<string, number>): SafeTokenAvailability[] {
  return held.map((t) => ({
    address: t.address,
    symbol: t.symbol,
    decimals: t.decimals,
    balance: t.balance,
    available: String(Math.max(0, Number(t.balance) - (reservedByToken.get(tokenKey(t.address)) ?? 0))),
  }));
}

/** Chains (Base + mainnet) a project's Safe can pay from — where it's deployed AND
 *  the proposer is a registered delegate — each with its spendable tokens. */
export async function getSafeOptions(projectSlug: string): Promise<
  { ok: true; chains: SafeChainOption[] } | { ok: false; error: string }
> {
  const g = await globalGate();
  if (!g.ok) return g;
  const config = await prisma.bountyConfig.findUnique({ where: { projectSlug } });
  if (!config) return { ok: false, error: "Configure o Safe deste projeto primeiro." };
  const proposer = proposerAddress();
  const reservedRows = await prisma.bounty.findMany({
    where: { projectSlug, status: { in: ["open", "proposed"] } },
    select: { amount: true, tokenAddress: true, chainId: true },
  });

  const chains: SafeChainOption[] = [];
  for (const c of SUPPORTED_CHAINS) {
    const info = await fetchSafeInfo(config.safeAddress, c.chainId);
    if (!info?.exists) continue;
    const delegate = proposer ? await isProposerDelegate(config.safeAddress, c.chainId, proposer) : false;
    if (!delegate) continue; // can't propose here → don't offer it
    const held = await fetchSafeTokens(config.safeAddress, c.chainId);
    const reserved = new Map<string, number>();
    for (const b of reservedRows.filter((r) => r.chainId === c.chainId)) {
      reserved.set(tokenKey(b.tokenAddress), (reserved.get(tokenKey(b.tokenAddress)) ?? 0) + (Number(b.amount) || 0));
    }
    chains.push({ chainId: c.chainId, name: c.name, tokens: withAvailability(held, reserved) });
  }
  return { ok: true, chains };
}

/** Reserve a bounty — pick a chain + a token the Safe holds there, capped at its available balance. */
export async function createBounty(input: {
  projectSlug: string;
  taskKey: string;
  title: string;
  chainId: number;
  tokenAddress: string | null;
  amount: string;
}): Promise<{ ok: true; bounty: BountyDTO } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  if (!validSlug(input.projectSlug)) return { ok: false, error: "Portal inválido." };
  if (!SUPPORTED_CHAINS.some((c) => c.chainId === input.chainId)) return { ok: false, error: "Rede não suportada." };
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

  // The value must be a token the Safe holds on the chosen chain, capped at available.
  const held = await fetchSafeTokens(config.safeAddress, input.chainId);
  const want = tokenKey(input.tokenAddress);
  const token = held.find((t) => tokenKey(t.address) === want);
  if (!token) return { ok: false, error: "Esse token não está no Safe nessa rede (ou sem saldo)." };

  const open = await prisma.bounty.findMany({
    where: { projectSlug: input.projectSlug, chainId: input.chainId, status: { in: ["open", "proposed"] }, ...(existing ? { id: { not: existing.id } } : {}) },
    select: { amount: true, tokenAddress: true },
  });
  const reservedSame = open
    .filter((b) => tokenKey(b.tokenAddress) === want)
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const available = Number(token.balance) - reservedSame;
  if (amount > available + 1e-12) {
    return { ok: false, error: `Acima do disponível: ${available} ${token.symbol} livre (${token.balance} no Safe, ${reservedSame} reservado).` };
  }

  const data = {
    title: input.title.slice(0, 300),
    amount: String(amount),
    chainId: input.chainId,
    tokenSymbol: token.symbol,
    tokenAddress: token.address,
    tokenDecimals: token.decimals,
    status: "open",
    createdBy: g.who.username,
  };
  const row = existing
    ? await prisma.bounty.update({ where: { id: existing.id }, data: { ...data, payeeAddress: null, safeTxHash: null } })
    : await prisma.bounty.create({ data: { projectSlug: input.projectSlug, taskKey, ...data } });
  return { ok: true, bounty: toDTO(row) };
}

/** Mark a proposed bounty as paid (after owners execute the Safe tx on-chain). */
export async function markBountyPaid(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const b = await prisma.bounty.findUnique({ where: { id } });
  if (!b) return { ok: false, error: "Bounty não encontrado." };
  await prisma.bounty.update({ where: { id }, data: { status: "paid" } });
  return { ok: true };
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

  // Pay on the bounty's own chain (Base or mainnet), in its own token.
  const tx = safeTxService(b.chainId);
  const safe = getAddress(config.safeAddress);
  const amountUnits = parseUnits(b.amount, b.tokenDecimals);

  // ETH transfer vs ERC-20 transfer(payee, amount).
  let to: `0x${string}`;
  let value: bigint;
  let data: `0x${string}`;
  if (b.tokenAddress) {
    to = getAddress(b.tokenAddress);
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
    const domain = { chainId: b.chainId, verifyingContract: safe } as const;
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
    const appUrl = `https://app.safe.global/transactions/queue?safe=${b.chainId === 1 ? "eth" : "base"}:${safe}`;
    return { ok: true, safeTxHash, url: appUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao propor pagamento." };
  }
}
