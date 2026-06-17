import "server-only";
import { prisma } from "@/lib/prisma";

// Lightweight GitHub OAuth (no next-auth) that maps a GitHub identity to a team
// member, then the app's normal session/RBAC takes over. Credentials are
// per-project (`${PREFIX}_GITHUB_OAUTH_CLIENT_ID/SECRET`) with a global fallback;
// each portal registers its own OAuth App callback (`<origin>/api/auth/github/callback`).

export function githubOAuthCreds(prefix?: string): { clientId: string; clientSecret: string } | null {
  const id = (prefix && process.env[`${prefix}_GITHUB_OAUTH_CLIENT_ID`]) || process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = (prefix && process.env[`${prefix}_GITHUB_OAUTH_CLIENT_SECRET`]) || process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!id?.trim() || !secret?.trim()) return null;
  return { clientId: id.trim(), clientSecret: secret.trim() };
}

/** Normalize a GitHub login (strip url / @ / trailing path). */
export function normGithub(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
}

export async function exchangeGithubCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(9000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => null)) as { access_token?: string } | null;
  return j?.access_token ?? null;
}

export async function fetchGithubUser(token: string): Promise<{ login: string; emails: string[] } | null> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "portal-skatehive" };
  const uRes = await fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(9000) }).catch(() => null);
  if (!uRes || !uRes.ok) return null;
  const u = (await uRes.json().catch(() => null)) as { login?: string; email?: string } | null;
  if (!u?.login) return null;
  let emails = u.email ? [u.email.toLowerCase()] : [];
  const eRes = await fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(9000) }).catch(() => null);
  if (eRes?.ok) {
    const arr = (await eRes.json().catch(() => [])) as { email: string; verified: boolean }[];
    const verified = arr.filter((e) => e.verified).map((e) => e.email.toLowerCase());
    if (verified.length) emails = verified;
  }
  return { login: u.login, emails };
}

/** Map a GitHub login/emails to a team member username (Hive). null = no match. */
export async function resolveMemberFromGithub(login: string, emails: string[]): Promise<string | null> {
  const gh = normGithub(login);
  const ident = await prisma.authIdentity
    .findUnique({ where: { provider_providerId: { provider: "github", providerId: gh } } })
    .catch(() => null);
  if (ident) return ident.username;
  const ghRows = await prisma.teamMemberContact.findMany({ where: { label: "GitHub" } }).catch(() => [] as { username: string; value: string }[]);
  const byGh = ghRows.find((r) => normGithub(r.value) === gh);
  if (byGh) return byGh.username.toLowerCase();
  if (emails.length) {
    const emailRows = await prisma.teamMemberContact.findMany({ where: { label: "Email" } }).catch(() => [] as { username: string; value: string }[]);
    const byEmail = emailRows.find((r) => emails.includes(r.value.trim().toLowerCase()));
    if (byEmail) return byEmail.username.toLowerCase();
  }
  return null;
}

export async function linkGithubIdentity(login: string, username: string, email: string | null): Promise<void> {
  const gh = normGithub(login);
  await prisma.authIdentity
    .upsert({
      where: { provider_providerId: { provider: "github", providerId: gh } },
      update: { username, email },
      create: { provider: "github", providerId: gh, username, email },
    })
    .catch(() => {});
}
