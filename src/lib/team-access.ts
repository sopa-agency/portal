import "server-only";
import { prisma } from "@/lib/prisma";
import { verifySessionToken, isAllowed, GLOBAL_ALLOWLIST, type SessionPayload } from "@/lib/auth";
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
  const [rows, projectCount] = await Promise.all([
    prisma.teamMember
      .findMany({ where: { username: u, projectSlug: { in: [GLOBAL_SLUG, project.slug] } } })
      .catch(() => [] as { projectSlug: string; role: string }[]),
    prisma.teamMember.count({ where: { projectSlug: project.slug } }).catch(() => 0),
  ]);
  if (rows.some((r) => r.projectSlug === GLOBAL_SLUG)) return { allowed: true, role: "admin", global: true };
  if (GLOBAL_ALLOWLIST.includes(u)) return { allowed: true, role: "admin", global: true };
  const projRow = rows.find((r) => r.projectSlug === project.slug);
  if (projRow) return { allowed: true, role: asRole(projRow.role), global: false };
  if (projectCount > 0) return { allowed: false, role: null, global: false }; // seeded → DB authoritative
  if (isAllowed(u, project)) return { allowed: true, role: "member", global: false }; // unseeded → config
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

/**
 * Seed a project's TeamMember rows from the static allowlist on first write, so
 * flipping the project to "DB authoritative" never locks out existing config
 * members. No-op once the project has any rows. Also seeds the global-admin rows.
 */
export async function ensureSeeded(project: ProjectConfig): Promise<void> {
  const count = await prisma.teamMember.count({ where: { projectSlug: project.slug } });
  if (count === 0) {
    await prisma.teamMember.createMany({
      data: project.allowlist.map((u) => ({ projectSlug: project.slug, username: u.toLowerCase(), role: "member" })),
      skipDuplicates: true,
    });
  }
  await prisma.teamMember.createMany({
    data: GLOBAL_ALLOWLIST.map((u) => ({ projectSlug: GLOBAL_SLUG, username: u.toLowerCase(), role: "admin" })),
    skipDuplicates: true,
  });
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
