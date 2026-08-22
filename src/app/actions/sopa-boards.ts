"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPinataSignedUploadUrl } from "@/lib/social-publish";
import { ensForwardResolves } from "@/lib/ens";
import { getActiveProject } from "@/projects/index";

// ---------------------------------------------------------------------------
// SOPA editable boards — shared CRUD for the org-chart flowchart and the
// portfolio. Both are SOPA-only; every action asserts the active project is
// SOPA so another portal can never read or mutate these rows.
// ---------------------------------------------------------------------------

export type BoardKind = "orgchart" | "portfolio";

export type TeamMember = { role: string; username: string };

/** A project's income source (org-chart card). Manual = just label + detail.
 *  A wallet/contract/split additionally carries an on-chain address (+ chain)
 *  so its balance can be tracked live. */
export type RevenueKind = "manual" | "wallet" | "contract" | "split";
export type RevenueStream = {
  label: string;
  detail: string | null;
  kind: RevenueKind;
  /** EVM chain key ("base" | "ethereum" | …); null = track across all chains. */
  chain: string | null;
  /** 0x… receiving address (wallet, contract, or 0xSplits split). */
  address: string | null;
};

const REVENUE_KINDS: RevenueKind[] = ["manual", "wallet", "contract", "split"];
const asKind = (v: unknown): RevenueKind => (REVENUE_KINDS.includes(v as RevenueKind) ? (v as RevenueKind) : "manual");

export type BoardCard = {
  id: string;
  board: string;
  parentId: string | null;
  title: string;
  body: string | null;
  logoUrl: string | null;
  /** org-chart only: engagement tier id ("pontual" | "operacao" | "motor"). */
  tier: string | null;
  /** org-chart only: assigned roles → person. */
  team: TeamMember[];
  /** org-chart only: the project's revenue streams. */
  revenueStreams: RevenueStream[];
  /** Public website URL for the project. */
  website: string | null;
  /** Attached GitHub org (or user) login. */
  githubOrg: string | null;
  /** Selected relevant repos under the org (full names "owner/repo"). */
  repos: string[];
  order: number;
};

/** Patchable fields stored inside the meta JSON blob. */
type MetaPatch = {
  logoUrl?: string | null;
  tier?: string | null;
  team?: TeamMember[];
  revenueStreams?: RevenueStream[];
  website?: string | null;
  githubOrg?: string | null;
  repos?: string[];
};

/** Merge meta patches onto the existing blob so updating one key never wipes the
 *  others (logo vs tier vs team are edited from different places). Returns
 *  Prisma.JsonNull when nothing is left so the column clears cleanly. */
function mergeMeta(
  current: Prisma.JsonValue | undefined,
  patch: MetaPatch,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const base: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  if (patch.logoUrl !== undefined) {
    if (patch.logoUrl) base.logoUrl = patch.logoUrl;
    else delete base.logoUrl;
  }
  if (patch.tier !== undefined) {
    if (patch.tier) base.tier = patch.tier;
    else delete base.tier;
  }
  if (patch.team !== undefined) {
    const clean = patch.team.filter((m) => m.username.trim());
    if (clean.length)
      base.team = clean.map((m) => ({ role: m.role, username: m.username.trim() }));
    else delete base.team;
  }
  if (patch.revenueStreams !== undefined) {
    const clean = patch.revenueStreams
      .map((r) => {
        const kind = asKind(r.kind);
        const base: Record<string, unknown> = { label: r.label.trim(), detail: r.detail?.trim() || null };
        // Only persist on-chain fields for tracked streams.
        if (kind !== "manual") {
          base.kind = kind;
          base.chain = r.chain?.trim() || null;
          base.address = r.address?.trim() || null;
        }
        return base as { label: string };
      })
      .filter((r) => r.label);
    if (clean.length) base.revenueStreams = clean;
    else delete base.revenueStreams;
  }
  if (patch.website !== undefined) {
    if (patch.website?.trim()) base.website = patch.website.trim();
    else delete base.website;
  }
  if (patch.githubOrg !== undefined) {
    if (patch.githubOrg?.trim()) base.githubOrg = patch.githubOrg.trim();
    else delete base.githubOrg;
  }
  if (patch.repos !== undefined) {
    const clean = [...new Set(patch.repos.map((r) => r.trim()).filter(Boolean))];
    if (clean.length) base.repos = clean;
    else delete base.repos;
  }
  return Object.keys(base).length ? (base as Prisma.InputJsonValue) : Prisma.JsonNull;
}

async function assertSopa() {
  const project = await getActiveProject();
  if (project.slug !== "sopa") {
    throw new Error("Boards are only available on the SOPA portal.");
  }
}

function toCard(r: {
  id: string;
  board: string;
  parentId: string | null;
  title: string;
  body: string | null;
  meta: Prisma.JsonValue;
  order: number;
}): BoardCard {
  const meta =
    r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)
      ? (r.meta as Record<string, unknown>)
      : {};
  const team: TeamMember[] = Array.isArray(meta.team)
    ? (meta.team as unknown[])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        // `name` fallback keeps any early free-text entries working.
        .map((m) => ({
          role: String(m.role ?? ""),
          username: String(m.username ?? m.name ?? ""),
        }))
        .filter((m) => m.role && m.username)
    : [];
  const revenueStreams: RevenueStream[] = Array.isArray(meta.revenueStreams)
    ? (meta.revenueStreams as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          label: String(s.label ?? "").trim(),
          detail: s.detail ? String(s.detail).trim() : null,
          kind: asKind(s.kind),
          chain: typeof s.chain === "string" && s.chain.trim() ? s.chain.trim() : null,
          address: typeof s.address === "string" && s.address.trim() ? s.address.trim() : null,
        }))
        .filter((s) => s.label)
    : [];
  return {
    id: r.id,
    board: r.board,
    parentId: r.parentId,
    title: r.title,
    body: r.body,
    logoUrl: typeof meta.logoUrl === "string" ? meta.logoUrl : null,
    tier: typeof meta.tier === "string" ? meta.tier : null,
    team,
    revenueStreams,
    website: typeof meta.website === "string" ? meta.website : null,
    githubOrg: typeof meta.githubOrg === "string" ? meta.githubOrg : null,
    repos: Array.isArray(meta.repos)
      ? (meta.repos as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())
      : [],
    order: r.order,
  };
}

/** All cards for a board, ordered. Seeds the org-chart with SOPA → Blockwire on
 *  first load so the page is never empty. */
export async function listBoard(board: BoardKind): Promise<BoardCard[]> {
  await assertSopa();
  let rows = await prisma.sopaBoard.findMany({
    where: { board },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  if (rows.length === 0 && board === "orgchart") {
    const root = await prisma.sopaBoard.create({
      data: { board, parentId: null, title: "SOPA", order: 0 },
    });
    await prisma.sopaBoard.createMany({
      data: [
        { board, parentId: root.id, title: "Blockwire", order: 0 },
      ],
    });
    rows = await prisma.sopaBoard.findMany({
      where: { board },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
  }

  return rows.map(toCard);
}

export type OrgRepoOption = { fullName: string; name: string; description: string | null; private: boolean };

/** List a GitHub org's/user's repos so a card can attach the relevant ones. */
export async function listOrgRepos(
  org: string,
): Promise<{ ok: true; repos: OrgRepoOption[] } | { ok: false; error: string }> {
  await assertSopa();
  const { getActiveProject } = await import("@/projects/index");
  const { resolveGitHubToken, fetchOrgRepos } = await import("@/lib/github-project");
  const token = resolveGitHubToken(await getActiveProject());
  if (!token) return { ok: false, error: "GITHUB_TOKEN não configurado no portal." };
  const r = await fetchOrgRepos(token, org);
  if (!r.ok) return r;
  return {
    ok: true,
    repos: r.repos.map((x) => ({ fullName: x.fullName, name: x.name, description: x.description, private: x.private })),
  };
}

export type RevenueBalance = { key: string; totalUsd: number; tokens: { symbol: string; chain: string; balance: number; valueUsd: number }[]; error?: string };

/** Live balances for tracked revenue streams (wallets/contracts/splits). Keyed by
 *  "<chain|all>:<address>" so the client can map results back to rows. */
export async function getRevenueBalances(
  targets: { chain: string | null; address: string }[],
): Promise<{ ok: true; balances: RevenueBalance[] } | { ok: false; error: string }> {
  await assertSopa();
  const { fetchAddressBalance } = await import("@/lib/treasury");
  const keyOf = (t: { chain: string | null; address: string }) =>
    `${t.chain ?? "all"}:${t.address.trim().toLowerCase()}`;
  // Dedupe identical (chain,address) pairs.
  const uniq = new Map<string, { chain: string | null; address: string }>();
  for (const t of targets) {
    if (!t.address?.trim()) continue;
    uniq.set(keyOf(t), { chain: t.chain, address: t.address.trim() });
  }
  const balances = await Promise.all(
    [...uniq.entries()].map(async ([key, t]) => {
      const r = await fetchAddressBalance(t.address, t.chain).catch((e) => ({ totalUsd: 0, tokens: [], error: String(e) }));
      return { key, totalUsd: r.totalUsd, tokens: r.tokens, error: r.error } as RevenueBalance;
    }),
  );
  return { ok: true, balances };
}

export type RevenueFlowResult = { key: string } & import("@/lib/revenue-onchain").RevenueFlow;

/** On-chain flow history (received / paid-out / cumulative-received series) for the
 *  given tracked addresses, via keyless Blockscout. Keyed by "<chain|all>:<addr>". */
export async function getRevenueFlows(
  targets: { chain: string | null; address: string }[],
): Promise<{ ok: true; flows: RevenueFlowResult[] } | { ok: false; error: string }> {
  await assertSopa();
  const { fetchAddressFlows } = await import("@/lib/revenue-onchain");
  const keyOf = (t: { chain: string | null; address: string }) => `${t.chain ?? "all"}:${t.address.trim().toLowerCase()}`;
  const uniq = new Map<string, { chain: string | null; address: string }>();
  for (const t of targets) {
    if (!t.address?.trim()) continue;
    uniq.set(keyOf(t), { chain: t.chain, address: t.address.trim() });
  }
  const flows = await Promise.all(
    [...uniq.entries()].map(async ([key, t]) => {
      const f = await fetchAddressFlows(t.address, t.chain).catch((e) => ({ receivedUsd: 0, paidUsd: 0, series: [], truncated: false, error: String(e) }));
      return { key, ...f } as RevenueFlowResult;
    }),
  );
  return { ok: true, flows };
}

export type RealizedRevenueResult = { key: string } & import("@/lib/revenue-onchain").RealizedRevenue;

/** Realized gross revenue via decoded events (AuctionSettled / SplitDistributed) —
 *  the accurate NFT-auction / split-distribution income, keyed by "<chain|all>:<addr>". */
export async function getRevenueRealized(
  targets: { chain: string | null; address: string }[],
): Promise<{ ok: true; realized: RealizedRevenueResult[] } | { ok: false; error: string }> {
  await assertSopa();
  const { fetchOnchainRevenue } = await import("@/lib/revenue-onchain");
  const keyOf = (t: { chain: string | null; address: string }) => `${t.chain ?? "all"}:${t.address.trim().toLowerCase()}`;
  const uniq = new Map<string, { chain: string | null; address: string }>();
  for (const t of targets) {
    if (!t.address?.trim()) continue;
    uniq.set(keyOf(t), { chain: t.chain, address: t.address.trim() });
  }
  const realized = await Promise.all(
    [...uniq.entries()].map(async ([key, t]) => {
      const r = await fetchOnchainRevenue(t.address, t.chain).catch(() => ({ method: "none" as const, revenueUsd: 0, count: 0, series: [], truncated: false }));
      return { key, ...r } as RealizedRevenueResult;
    }),
  );
  return { ok: true, realized };
}

/** Historical trend (Δ7d/Δ30d + sparkline points) for a card's tracked addresses,
 *  compared against the current live balances the client just fetched. */
export async function getRevenueTrends(
  cardId: string,
  currentUsd: Record<string, number>,
): Promise<{ ok: true; trends: import("@/lib/revenue-snapshots").RevenueTrend[] } | { ok: false; error: string }> {
  await assertSopa();
  const { getRevenueTrends: computeTrends } = await import("@/lib/revenue-snapshots");
  const trends = await computeTrends(cardId, currentUsd);
  return { ok: true, trends };
}

/** Signed-URL handshake for a direct browser→Pinata logo upload, gated to SOPA.
 *  Mirrors signPostMediaUpload but without the Post Creator requirement (SOPA
 *  has no Post Creator, so that action's authGate would reject it). */
export async function signSopaLogoUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    await assertSopa();
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createCard(input: {
  board: BoardKind;
  parentId?: string | null;
  title: string;
  body?: string;
  logoUrl?: string;
  tier?: string | null;
  team?: TeamMember[];
  revenueStreams?: RevenueStream[];
  website?: string | null;
  githubOrg?: string | null;
  repos?: string[];
}): Promise<BoardCard> {
  await assertSopa();
  const title = input.title.trim() || "Sem título";
  // Append to the end of its sibling group.
  const siblings = await prisma.sopaBoard.count({
    where: { board: input.board, parentId: input.parentId ?? null },
  });
  const row = await prisma.sopaBoard.create({
    data: {
      board: input.board,
      parentId: input.parentId ?? null,
      title,
      body: input.body?.trim() || null,
      meta: mergeMeta(undefined, {
        logoUrl: input.logoUrl,
        tier: input.tier,
        team: input.team,
        revenueStreams: input.revenueStreams,
        website: input.website,
        githubOrg: input.githubOrg,
        repos: input.repos,
      }),
      order: siblings,
    },
  });
  revalidatePath(input.board === "orgchart" ? "/org-chart" : "/portfolio");
  return toCard(row);
}

export async function updateCard(
  id: string,
  patch: { title?: string; body?: string } & MetaPatch,
): Promise<BoardCard> {
  await assertSopa();
  const touchesMeta =
    patch.logoUrl !== undefined ||
    patch.tier !== undefined ||
    patch.team !== undefined ||
    patch.revenueStreams !== undefined ||
    patch.website !== undefined ||
    patch.githubOrg !== undefined ||
    patch.repos !== undefined;
  const existing = touchesMeta
    ? await prisma.sopaBoard.findUnique({ where: { id }, select: { meta: true } })
    : null;
  const row = await prisma.sopaBoard.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || "Sem título" } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() || null } : {}),
      ...(touchesMeta ? { meta: mergeMeta(existing?.meta, patch) } : {}),
    },
  });
  revalidatePath(row.board === "orgchart" ? "/org-chart" : "/portfolio");
  return toCard(row);
}

/** Delete a card. For the org-chart, also removes the whole subtree so no
 *  orphaned descendants are left dangling. The SOPA root cannot be deleted. */
export async function deleteCard(id: string): Promise<{ deleted: string[] }> {
  await assertSopa();
  const target = await prisma.sopaBoard.findUnique({ where: { id } });
  if (!target) return { deleted: [] };

  if (target.board === "orgchart" && target.parentId === null) {
    throw new Error("The SOPA root cannot be deleted.");
  }

  const toDelete = [id];
  if (target.board === "orgchart") {
    // Walk descendants breadth-first.
    let frontier = [id];
    while (frontier.length) {
      const children = await prisma.sopaBoard.findMany({
        where: { board: "orgchart", parentId: { in: frontier } },
        select: { id: true },
      });
      const ids = children.map((c) => c.id);
      toDelete.push(...ids);
      frontier = ids;
    }
  }

  await prisma.sopaBoard.deleteMany({ where: { id: { in: toDelete } } });
  revalidatePath(target.board === "orgchart" ? "/org-chart" : "/portfolio");
  return { deleted: toDelete };
}

// ---------------------------------------------------------------------------
// Address book — suggest an ENS/label for a tracked address. Verified means the
// name forward-resolves to the address on mainnet at save time; an unverified
// suggestion is still stored (and shown flagged), never silently trusted.
// ---------------------------------------------------------------------------
export type EnsSuggestion =
  | { address: string; ens: string; verified: boolean }
  | { error: string };

export async function suggestAddressEns(address: string, ens: string): Promise<EnsSuggestion> {
  await assertSopa();
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { error: "Endereço inválido." };

  const name = ens.trim().toLowerCase();
  if (!name) {
    // Empty = clear the suggestion (fall back to auto reverse-resolution).
    await prisma.addressLabel.deleteMany({ where: { address: addr } });
    revalidatePath("/org-chart");
    return { address: addr, ens: "", verified: false };
  }
  if (!name.includes(".")) return { error: "Informe um nome ENS (ex.: nome.eth)." };

  const verified = await ensForwardResolves(name, addr);
  const row = await prisma.addressLabel.upsert({
    where: { address: addr },
    create: { address: addr, ens: name, verified },
    update: { ens: name, verified },
  });
  revalidatePath("/org-chart");
  return { address: row.address, ens: row.ens, verified: row.verified };
}
