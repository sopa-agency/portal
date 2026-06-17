"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, GLOBAL_ALLOWLIST } from "@/lib/auth";
import { getActiveProject } from "@/projects/index";
import { authorize, getRoles, ensureSeeded, ROLES, GLOBAL_SLUG, type Role } from "@/lib/team-access";

export type ManagedMember = { username: string; role: Role; global: boolean; lastLoginAt: string | null };

const clean = (u: string) => u.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._-]/g, "");

async function viewerGate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, who };
}

async function adminGate() {
  const g = await viewerGate();
  if (!g.ok) return g;
  if (g.who.role !== "admin") return { ok: false as const, error: "Apenas admins podem gerenciar a equipe." };
  return g;
}

/** Effective members for the active project (allowlist ∪ DB rows) with roles. */
export async function listTeamMembers(): Promise<
  { ok: true; members: ManagedMember[]; viewerRole: Role; viewerGlobal: boolean } | { ok: false; error: string }
> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const dbRows = await prisma.teamMember
    .findMany({ where: { projectSlug: g.project.slug } })
    .catch(() => [] as { username: string }[]);
  const usernames = [...new Set([...g.project.allowlist.map((u) => u.toLowerCase()), ...dbRows.map((r) => r.username)])];
  const roleMap = await getRoles(g.project, usernames);
  const activity = await prisma.memberActivity
    .findMany({ where: { username: { in: usernames } }, select: { username: true, lastLoginAt: true } })
    .catch(() => [] as { username: string; lastLoginAt: Date }[]);
  const lastSeen = new Map(activity.map((a) => [a.username, a.lastLoginAt.toISOString()]));
  const members = usernames
    .map((u) => ({ username: u, role: roleMap.get(u)?.role ?? "member", global: !!roleMap.get(u)?.global, lastLoginAt: lastSeen.get(u) ?? null }))
    .sort((a, b) => {
      const rank = (m: ManagedMember) => (m.global ? 0 : m.role === "admin" ? 1 : m.role === "member" ? 2 : 3);
      return rank(a) - rank(b) || a.username.localeCompare(b.username);
    });
  return { ok: true, members, viewerRole: g.who.role, viewerGlobal: g.who.global };
}

export async function setMemberRole(username: string, role: Role): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  if (!ROLES.includes(role)) return { ok: false, error: "Cargo inválido." };
  const u = clean(username);
  if (!u) return { ok: false, error: "Usuário inválido." };
  await ensureSeeded(g.project);
  await prisma.teamMember.upsert({
    where: { projectSlug_username: { projectSlug: g.project.slug, username: u } },
    update: { role },
    create: { projectSlug: g.project.slug, username: u, role, addedBy: g.who.username },
  });
  return { ok: true };
}

export async function addMember(username: string, role: Role = "member"): Promise<{ ok: true } | { ok: false; error: string }> {
  return setMemberRole(username, role);
}

export async function removeMember(username: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  const u = clean(username);
  if (u === g.who.username.toLowerCase()) return { ok: false, error: "Você não pode remover a si mesmo." };
  if (GLOBAL_ALLOWLIST.includes(u)) return { ok: false, error: "Admins globais são removidos pela alternância de admin global." };
  await ensureSeeded(g.project);
  await prisma.teamMember.deleteMany({ where: { projectSlug: g.project.slug, username: u } });
  return { ok: true };
}

/** Grant/revoke GLOBAL admin (access to every portal). Global admins only. */
export async function setGlobalAdmin(username: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await adminGate();
  if (!g.ok) return g;
  if (!g.who.global) return { ok: false, error: "Apenas admins globais podem definir outros admins globais." };
  const u = clean(username);
  if (!u) return { ok: false, error: "Usuário inválido." };
  if (on) {
    await prisma.teamMember.upsert({
      where: { projectSlug_username: { projectSlug: GLOBAL_SLUG, username: u } },
      update: { role: "admin" },
      create: { projectSlug: GLOBAL_SLUG, username: u, role: "admin", addedBy: g.who.username },
    });
  } else {
    if (GLOBAL_ALLOWLIST.includes(u)) return { ok: false, error: "Este admin global é fixo no código." };
    await prisma.teamMember.deleteMany({ where: { projectSlug: GLOBAL_SLUG, username: u } });
  }
  return { ok: true };
}
