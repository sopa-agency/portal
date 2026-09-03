import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, withDbRetry } from "@/lib/prisma";
import { verifySessionToken, isAllowed, GLOBAL_ALLOWLIST, type SessionPayload } from "@/lib/auth";
import { identidades } from "@/lib/member-identity";
import type { ProjectConfig } from "@/projects/types";

// Node-runtime authorization layer. The proxy/middleware only AUTHENTICATES
// (verifySessionToken, edge-safe, no DB). Membership + role come from the DB
// (TeamMember), with the static project.allowlist / GLOBAL_ALLOWLIST as fallback
// so access keeps working before the table is seeded.

export type Role = "admin" | "member" | "viewer";
export const ROLES: Role[] = ["admin", "member", "viewer"];
export const GLOBAL_SLUG = "*"; // TeamMember.projectSlug for a global admin

export type Access = { allowed: boolean; role: Role | null; global: boolean };

const asRole = (r: string): Role => (ROLES.includes(r as Role) ? (r as Role) : "member");

/**
 * Effective access for a username on a project.
 * - A global admin row (projectSlug "*") or code GLOBAL_ALLOWLIST → global admin.
 * - A per-project DB row → that role.
 * - Otherwise: if the project has ANY DB rows it is SEEDED → DB is authoritative,
 *   so a non-member is denied (this is what makes "remove" effective). If the
 *   project has NO rows yet it is unseeded → fall back to the static allowlist.
 * DB errors fall back to config (count 0 → unseeded), so a DB outage can't lock
 * everyone out.
 */
export async function getAccess(username: string, project: ProjectConfig): Promise<Access> {
  const u = username.toLowerCase();
  // Uma pessoa pode entrar por vários logins (ver member-identity.ts). O acesso
  // é a UNIÃO dos logins dela: apelidar não pode TIRAR privilégio de ninguém,
  // senão arrumar cadastro vira mudança de segurança disfarçada. Se a leitura
  // dos apelidos falhar, sobra o login que veio — o comportamento de antes.
  const eus = await identidades(u).catch(() => [u]);
  const [rows, projectCount] = await Promise.all([
    prisma.teamMember
      .findMany({ where: { username: { in: eus }, projectSlug: { in: [GLOBAL_SLUG, project.slug] } } })
      .catch(() => [] as { projectSlug: string; role: string }[]),
    prisma.teamMember.count({ where: { projectSlug: project.slug } }).catch(() => 0),
  ]);
  if (rows.some((r) => r.projectSlug === GLOBAL_SLUG)) return { allowed: true, role: "admin", global: true };
  if (eus.some((e) => GLOBAL_ALLOWLIST.includes(e))) return { allowed: true, role: "admin", global: true };
  // Entre vários logins com papel diferente, vale o MAIOR: a pessoa é uma só,
  // e ela já podia fazer o que o login mais forte permitia.
  const ORDEM: Role[] = ["viewer", "member", "admin"];
  const projRows = rows.filter((r) => r.projectSlug === project.slug);
  if (projRows.length) {
    const melhor = projRows.map((r) => asRole(r.role)).sort((a, b) => ORDEM.indexOf(b) - ORDEM.indexOf(a))[0];
    return { allowed: true, role: melhor, global: false };
  }
  if (projectCount > 0) return { allowed: false, role: null, global: false }; // seeded → DB authoritative
  if (eus.some((e) => isAllowed(e, project))) return { allowed: true, role: "member", global: false }; // unseeded → config
  return { allowed: false, role: null, global: false };
}

/**
 * Verify a session AND authorize it against the project (DB-backed). Returns the
 * session only when the user has access. Without a project it authenticates only.
 * Drop-in replacement for the old auth.verifySession used by pages/actions/API.
 */
export async function verifySession(
  token: string | undefined,
  project?: ProjectConfig,
): Promise<SessionPayload | null> {
  const s = await verifySessionToken(token);
  if (!s) return null;
  if (!project) return s;
  const access = await getAccess(s.username, project);
  return access.allowed ? s : null;
}

/** Like verifySession but returns the role too (for admin-gated work). */
export async function authorize(
  token: string | undefined,
  project: ProjectConfig,
): Promise<{ username: string; role: Role; global: boolean } | null> {
  const s = await verifySessionToken(token);
  if (!s) return null;
  const a = await getAccess(s.username, project);
  return a.allowed ? { username: s.username, role: a.role!, global: a.global } : null;
}

/** Prisma client or an open interactive transaction — both accept model calls. */
type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Seed a project's TeamMember rows from the static allowlist on first write, so
 * flipping the project to "DB authoritative" never locks out existing config
 * members. No-op once the project has any rows. Also seeds the global-admin rows.
 *
 * MUST run in the same transaction as the write that triggers it — see
 * withSeeded. The first row written to a project is what makes getAccess treat
 * the DB as authoritative, so a write that lands while the seed doesn't locks
 * every config member out of the portal (this happened to gnars on 2026-08-15:
 * one added member, thirteen locked out).
 */
export async function ensureSeeded(project: ProjectConfig, db: Db = prisma): Promise<void> {
  const count = await db.teamMember.count({ where: { projectSlug: project.slug } });
  if (count === 0) {
    await db.teamMember.createMany({
      data: project.allowlist.map((u) => ({ projectSlug: project.slug, username: u.toLowerCase(), role: "member" })),
      skipDuplicates: true,
    });
  }
  await db.teamMember.createMany({
    data: GLOBAL_ALLOWLIST.map((u) => ({ projectSlug: GLOBAL_SLUG, username: u.toLowerCase(), role: "admin" })),
    skipDuplicates: true,
  });
}

/**
 * Run a TeamMember write with the project's seed, atomically: either both land
 * or neither does. Retries the pair on transient DB errors (a cold pooler
 * failing mid-way is the one way the seed and the write could ever diverge);
 * every step is idempotent, so replaying the transaction is safe.
 *
 * The timeouts are explicit because Prisma's defaults (maxWait 2s, timeout 5s)
 * are tight for this body: up to four round trips through the Supabase pgBouncer
 * pooler, and the first-write path adds a createMany of the whole allowlist.
 * Blowing the default budget would raise P2028 — a failure mode the non-atomic
 * code simply couldn't have.
 */
export async function withSeeded<T>(
  project: ProjectConfig,
  write: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withDbRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await ensureSeeded(project, tx);
        return write(tx);
      },
      { maxWait: 15_000, timeout: 30_000 },
    ),
  );
}

/** Effective roles for a set of usernames on a project (for the roster/UI). */
export async function getRoles(
  project: ProjectConfig,
  usernames: string[],
): Promise<Map<string, { role: Role; global: boolean }>> {
  const lower = usernames.map((u) => u.toLowerCase());
  const rows = await prisma.teamMember
    .findMany({ where: { projectSlug: { in: [GLOBAL_SLUG, project.slug] }, username: { in: lower } } })
    .catch(() => [] as { projectSlug: string; username: string; role: string }[]);
  const globals = new Set(rows.filter((r) => r.projectSlug === GLOBAL_SLUG).map((r) => r.username));
  const proj = new Map(rows.filter((r) => r.projectSlug === project.slug).map((r) => [r.username, asRole(r.role)]));
  const out = new Map<string, { role: Role; global: boolean }>();
  for (const u of lower) {
    if (globals.has(u)) out.set(u, { role: "admin", global: true });
    else if (proj.has(u)) out.set(u, { role: proj.get(u)!, global: false });
    else if (GLOBAL_ALLOWLIST.includes(u)) out.set(u, { role: "admin", global: true });
    else out.set(u, { role: "member", global: false });
  }
  return out;
}
