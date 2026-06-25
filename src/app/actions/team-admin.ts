"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, GLOBAL_ALLOWLIST } from "@/lib/auth";
import { getActiveProject, getAllProjects, getProject } from "@/projects/index";
import { authorize, getRoles, ensureSeeded, ROLES, GLOBAL_SLUG, type Role } from "@/lib/team-access";
import type { AggregatedItem } from "@/lib/github-project";
import { loadCardMeta } from "@/lib/card-meta";
import { compareByPriority } from "@/lib/kanban-priority";
import { sanitizeSkills } from "@/lib/skills";

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

export type MemberTask = {
  /** GitHub Project item id — opens the card on the Kanban via /kanban?open=<id>. */
  id: string;
  title: string;
  url?: string;
  status: string;
  state?: string;
  number?: number;
  body?: string;
  /** Board "Priority" single-select value (e.g. "P0", "High"), if set. */
  priority?: string;
  /** Portal-owned priority points 1🔥..5🔥. */
  firePriority?: number;
  /** Portal-owned due date (yyyy-mm-dd). */
  deadline?: string;
  assignees?: { login: string; avatarUrl: string }[];
  labels?: { name: string; color: string }[];
  /** Project/board name — set on the SOPA aggregated view (tasks across portals). */
  board?: string;
  /** Owning portal slug. */
  projectSlug?: string;
  /** Full card payload to open the Kanban dialog in place (no navigation). */
  card?: AggregatedItem;
};

/** Kanban tasks (GitHub Project items) assigned to a member's GitHub login. */
export async function getMemberTasks(
  githubLogin: string,
): Promise<{ ok: true; tasks: MemberTask[]; projectUrl?: string } | { ok: false; error: string }> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const login = githubLogin.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/.*$/, "");
  if (!login) return { ok: true, tasks: [] };
  const { fetchGitHubProject } = await import("@/lib/github-project");

  // Merge portal-owned fire priority + deadline onto each task (and its card
  // payload), then sort priority-first so For You leads with what matters.
  const finalize = async (
    tasks: MemberTask[],
    projectUrl?: string,
  ): Promise<{ ok: true; tasks: MemberTask[]; projectUrl?: string }> => {
    const meta = await loadCardMeta(tasks.map((t) => t.id));
    for (const t of tasks) {
      const m = meta.get(t.id);
      if (!m) continue;
      t.firePriority = m.firePriority;
      t.deadline = m.deadline;
      if (t.card) {
        t.card.firePriority = m.firePriority;
        t.card.deadline = m.deadline;
      }
    }
    tasks.sort(compareByPriority);
    return { ok: true, tasks, projectUrl };
  };

  // SOPA hub (no own board, aggregates): collect the person's tasks across EVERY
  // portal's board, tagged with the project name.
  if (!g.project.githubProject) {
    if (!g.project.kanbanAggregate) return { ok: true, tasks: [] };
    const { getAllProjects } = await import("@/projects/index");
    const seen = new Set<string>();
    const tasks: MemberTask[] = [];
    for (const p of getAllProjects()) {
      if (!p.githubProject) continue;
      const key = `${p.githubProject.org}#${p.githubProject.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const board = await fetchGitHubProject(p).catch(() => null);
      if (!board || !board.ok) continue;
      const boardName = board.title || p.name;
      const statusOptions = board.columns.filter((c) => c.optionId).map((c) => ({ name: c.name, optionId: c.optionId! }));
      for (const col of board.columns) {
        for (const it of col.items) {
          if (it.assignees.some((a) => a.login.toLowerCase() === login)) {
            tasks.push({
              id: it.id,
              title: it.title,
              url: it.url,
              status: col.name,
              state: it.state,
              number: it.number,
              body: it.body,
              priority: it.priority,
              assignees: it.assignees,
              labels: it.labels.map((l) => ({ name: l.name, color: l.color })),
              board: boardName,
              projectSlug: p.slug,
              card: { ...it, board: boardName, accent: p.theme.accentDark, projectSlug: p.slug, projectId: board.projectId, statusFieldId: board.statusFieldId, statusOptions },
            });
          }
        }
      }
    }
    return finalize(tasks);
  }

  const board = await fetchGitHubProject(g.project);
  if (!board.ok) return { ok: false, error: board.error };
  const boardName = board.title || g.project.name;
  const statusOptions = board.columns.filter((c) => c.optionId).map((c) => ({ name: c.name, optionId: c.optionId! }));
  const tasks: MemberTask[] = [];
  for (const col of board.columns) {
    for (const it of col.items) {
      if (it.assignees.some((a) => a.login.toLowerCase() === login)) {
        tasks.push({
          id: it.id,
          title: it.title,
          url: it.url,
          status: col.name,
          state: it.state,
          number: it.number,
          body: it.body,
          assignees: it.assignees,
          labels: it.labels.map((l) => ({ name: l.name, color: l.color })),
          projectSlug: g.project.slug,
          card: { ...it, board: boardName, accent: g.project.theme.accentDark, projectSlug: g.project.slug, projectId: board.projectId, statusFieldId: board.statusFieldId, statusOptions },
        });
      }
    }
  }
  return finalize(tasks, board.url);
}

// ── Cross-portal access management (global admins — e.g. from the SOPA panel) ──

async function globalGate() {
  const g = await viewerGate();
  if (!g.ok) return g;
  if (!g.who.global) return { ok: false as const, error: "Apenas admins globais gerenciam acesso entre portais." };
  return g;
}

export type PortalAccess = {
  slug: string;
  name: string;
  members: { username: string; role: Role; global: boolean }[];
};

/** Access map across every portal (members + roles). Global admins only. */
export async function listAllPortalAccess(): Promise<{ ok: true; portals: PortalAccess[] } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const portals: PortalAccess[] = [];
  for (const p of getAllProjects()) {
    const dbRows = await prisma.teamMember.findMany({ where: { projectSlug: p.slug } }).catch(() => [] as { username: string }[]);
    const usernames = [...new Set([...p.allowlist.map((u) => u.toLowerCase()), ...dbRows.map((r) => r.username)])];
    const roleMap = await getRoles(p, usernames);
    const members = usernames
      .map((u) => ({ username: u, role: roleMap.get(u)?.role ?? ("member" as Role), global: !!roleMap.get(u)?.global }))
      .sort((a, b) => {
        const rank = (m: { global: boolean; role: Role }) => (m.global ? 0 : m.role === "admin" ? 1 : m.role === "member" ? 2 : 3);
        return rank(a) - rank(b) || a.username.localeCompare(b.username);
      });
    portals.push({ slug: p.slug, name: p.name, members });
  }
  return { ok: true, portals };
}

function resolvePortal(slug: string): { ok: true; project: ReturnType<typeof getProject> } | { ok: false; error: string } {
  const project = getProject(slug);
  if (project.slug !== slug) return { ok: false, error: "Portal inválido." };
  return { ok: true, project };
}

/** Grant/set a user's role on ANY portal. Global admins only. */
export async function setPortalAccess(projectSlug: string, username: string, role: Role): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  if (!ROLES.includes(role)) return { ok: false, error: "Cargo inválido." };
  const r = resolvePortal(projectSlug);
  if (!r.ok) return r;
  const u = clean(username);
  if (!u) return { ok: false, error: "Usuário inválido." };
  await ensureSeeded(r.project);
  await prisma.teamMember.upsert({
    where: { projectSlug_username: { projectSlug, username: u } },
    update: { role },
    create: { projectSlug, username: u, role, addedBy: g.who.username },
  });
  return { ok: true };
}

/** Revoke a user's access to a portal. Global admins only. */
export async function removePortalAccess(projectSlug: string, username: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await globalGate();
  if (!g.ok) return g;
  const r = resolvePortal(projectSlug);
  if (!r.ok) return r;
  const u = clean(username);
  if (GLOBAL_ALLOWLIST.includes(u)) return { ok: false, error: "Admin global fixo no código." };
  await ensureSeeded(r.project);
  await prisma.teamMember.deleteMany({ where: { projectSlug, username: u } });
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

// ── Member skills (radar chart) ──────────────────────────────────────────────

/** Skills (0–100 per category) + bio for a member. Any logged-in member can read. */
export async function getMemberSkills(
  username: string,
): Promise<{ ok: true; skills: Record<string, number>; bio: string; canEdit: boolean } | { ok: false; error: string }> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const target = username.toLowerCase().trim();
  const row = await prisma.memberSkills.findUnique({ where: { username: target } }).catch(() => null);
  const canEdit = g.who.username === target || g.who.role === "admin";
  return { ok: true, skills: (row?.skills as Record<string, number>) ?? {}, bio: row?.bio ?? "", canEdit };
}

/** Save a member's skills + bio — allowed for the member themselves or an admin. */
export async function setMemberSkills(
  username: string,
  skills: Record<string, number>,
  bio?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const target = username.toLowerCase().trim();
  if (g.who.username !== target && g.who.role !== "admin") {
    return { ok: false, error: "Só o próprio membro ou um admin pode editar os skills." };
  }
  const clean = sanitizeSkills(skills);
  const cleanBio = (bio ?? "").trim().slice(0, 600);
  try {
    await prisma.memberSkills.upsert({
      where: { username: target },
      create: { username: target, skills: clean, bio: cleanBio, updatedBy: g.who.username },
      update: { skills: clean, bio: cleanBio, updatedBy: g.who.username },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao salvar." };
  }
}
