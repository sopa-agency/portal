"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { encryptSecret } from "@/lib/secret-box";
import { mintMemberSigner, checkSignerStatus, sponsorConfigured } from "@/lib/farcaster-sponsor";

// Admin of the curation-trail account registry. Lives on the SOPA portal (team
// hub). Lets a global admin accumulate accounts + Hive posting keys (stored
// encrypted) so more accounts upvote/engage — strengthening the trail.

export type TrailAccountRow = {
  id: string;
  kind: string;
  label: string;
  ownerSlug: string | null;
  enabled: boolean;
  fid: number | null;
  hasFcSigner: boolean;
  hiveAccount: string | null;
  hasHiveKey: boolean; // env or encrypted
  autoLike: boolean;
  hiveVoteWeight: number;
  watch: boolean;
};

async function adminGate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  // Trail registry is global config — only SOPA (team hub) global admins.
  if (project.slug !== "sopa" || !who.global || who.role !== "admin") {
    return { ok: false as const, error: "Apenas admins globais (SOPA) podem gerenciar o trail." };
  }
  return { ok: true as const, who };
}

export async function listTrailAccounts(): Promise<
  { ok: true; accounts: TrailAccountRow[] } | { ok: false; error: string }
> {
  const g = await adminGate();
  if (!g.ok) return g;
  const rows = await prisma.trailAccount.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] }).catch(() => []);
  const accounts: TrailAccountRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    ownerSlug: r.ownerSlug,
    enabled: r.enabled,
    fid: r.fid,
    hasFcSigner: !!r.fcSignerUuid,
    hiveAccount: r.hiveAccount,
    hasHiveKey: !!(r.hiveKeyEnv || r.hiveKeyEnc),
    autoLike: r.autoLike,
    hiveVoteWeight: r.hiveVoteWeight,
    watch: r.watch,
  }));
  return { ok: true, accounts };
}

const clean = (s: string) => s.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._-]/g, "");

/** Validate a Hive posting key (WIF) and that it matches the account's posting authority. */
async function validateHiveKey(account: string, wif: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { PrivateKey } = await import("@hiveio/dhive");
    const pub = PrivateKey.fromString(wif).createPublic().toString();
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[account]], id: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    const acc = j?.result?.[0];
    if (!acc) return { ok: false, error: `Conta @${account} não encontrada na Hive.` };
    const keys: string[] = (acc.posting?.key_auths ?? []).map((k: [string, number]) => k[0]);
    if (!keys.includes(pub)) return { ok: false, error: `A chave não é a posting key de @${account}.` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Chave inválida (não é uma posting key WIF válida)." };
  }
}

/** Add or update a member/account in the trail with an encrypted Hive posting key. */
export async function upsertTrailHiveAccount(input: {
  id?: string;
  kind: "company" | "agent" | "member";
  label: string;
  hiveAccount: string;
  postingKey?: string; // optional on update (keep existing if blank)
  hiveVoteWeight?: number;
  autoLike?: boolean;
  watch?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;

  const label = clean(input.label || input.hiveAccount);
  const hiveAccount = clean(input.hiveAccount);
  if (!label || !hiveAccount) return { ok: false, error: "Informe um nome e a conta Hive." };

  const data: Record<string, unknown> = {
    kind: input.kind,
    label,
    hiveAccount,
    autoLike: input.autoLike ?? true,
    watch: input.watch ?? input.kind !== "member", // members engage but aren't watched by default
    hiveVoteWeight: Math.max(1, Math.min(10000, input.hiveVoteWeight ?? 10000)),
  };

  if (input.postingKey?.trim()) {
    const check = await validateHiveKey(hiveAccount, input.postingKey.trim());
    if (!check.ok) return { ok: false, error: check.error! };
    data.hiveKeyEnc = encryptSecret(input.postingKey.trim());
    data.hiveKeyEnv = null; // DB key wins; clear any env pointer
  }

  try {
    if (input.id) {
      await prisma.trailAccount.update({ where: { id: input.id }, data });
    } else {
      const existing = await prisma.trailAccount.findUnique({ where: { kind_label: { kind: input.kind, label } } }).catch(() => null);
      if (existing) await prisma.trailAccount.update({ where: { id: existing.id }, data });
      else await prisma.trailAccount.create({ data: data as never });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao salvar." };
  }
  return { ok: true };
}

export async function setTrailAccountEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  const g = await adminGate();
  if (!g.ok) return { ok: false };
  await prisma.trailAccount.update({ where: { id }, data: { enabled } }).catch(() => {});
  return { ok: true };
}

export async function removeTrailAccount(id: string): Promise<{ ok: boolean }> {
  const g = await adminGate();
  if (!g.ok) return { ok: false };
  await prisma.trailAccount.delete({ where: { id } }).catch(() => {});
  return { ok: true };
}

export function trailSponsorReady(): boolean {
  return sponsorConfigured();
}

/** Start connecting a trail account's Farcaster: mint a signer + approval QR.
 * The account's Farcaster owner scans + approves in their Warpcast. The client
 * holds the returned signer_uuid and calls finishTrailAccountFarcaster to poll. */
export async function startTrailAccountFarcaster(
  accountId: string,
): Promise<{ ok: true; signerUuid: string; qr: string; approvalUrl: string } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  if (!sponsorConfigured()) return { ok: false, error: "Sponsor de Farcaster não configurado." };
  const account = await prisma.trailAccount.findUnique({ where: { id: accountId } }).catch(() => null);
  if (!account) return { ok: false, error: "Conta não encontrada." };

  const minted = await mintMemberSigner();
  if (!minted.ok) return { ok: false, error: minted.error };
  return { ok: true, signerUuid: minted.data.signerUuid, qr: minted.data.qrDataUrl, approvalUrl: minted.data.approvalUrl };
}

/** Poll the signer; once approved, store it (+ fid/handle) on the trail account.
 * Only an approved signer is committed, so a forged call can't wire a bad one. */
export async function finishTrailAccountFarcaster(
  accountId: string,
  signerUuid: string,
): Promise<{ ok: true; status: string; handle?: string; fid?: number } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  const st = await checkSignerStatus(signerUuid);
  if (st.status !== "approved" || !st.fid) return { ok: true, status: st.status };

  await prisma.trailAccount
    .update({
      where: { id: accountId },
      // Signer is minted under the global (sponsor) Neynar app → use NEYNAR_API_KEY.
      data: { fcSignerUuid: signerUuid, fid: st.fid, fcApiKeyEnv: "NEYNAR_API_KEY" },
    })
    .catch(() => {});
  return { ok: true, status: "approved", handle: st.handle, fid: st.fid };
}
