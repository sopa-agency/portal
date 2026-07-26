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
import { EMPTY_PROFILE, sanitizeProfile, type MemberProfile } from "@/lib/member-profile";

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

  // A card the member already finished shouldn't show as an open task: skip
  // Done/Closed/Archived status columns and any closed/merged issue or PR.
  const DONE_COLUMN = /done|conclu|complete|shipped|archiv|encerrad|fechad|✅/i;
  const isDone = (colName: string, it: { state?: string; merged?: boolean }) =>
    DONE_COLUMN.test(colName) || it.merged === true || (it.state ?? "").toUpperCase() === "CLOSED";

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
          if (isDone(col.name, it)) continue;
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
              card: { ...it, board: boardName, accent: p.theme.accentDark, logo: p.theme.logo, projectSlug: p.slug, projectId: board.projectId, statusFieldId: board.statusFieldId, statusOptions },
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
      if (isDone(col.name, it)) continue;
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
          card: { ...it, board: boardName, accent: g.project.theme.accentDark, logo: g.project.theme.logo, projectSlug: g.project.slug, projectId: board.projectId, statusFieldId: board.statusFieldId, statusOptions },
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

// ── Contatos públicos ───────────────────────────────────────────────────────

/**
 * Opt-in de um contato pra aparecer no site público (site-sopa).
 *
 * Diferente de editar o valor do contato — que qualquer membro do portal pode
 * fazer, porque é dado operacional compartilhado — expor publicamente é decisão
 * de privacidade: só a própria pessoa ou um admin.
 *
 * A flag vale por PESSOA, não por portal: a mesma conta de Instagram é a mesma
 * em todos os portais, então o update alcança todas as linhas de username+label.
 */
export async function setContactPublic(
  username: string,
  label: string,
  isPublic: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const target = username.toLowerCase().trim();
  if (g.who.username !== target && g.who.role !== "admin") {
    return { ok: false, error: "Só a própria pessoa ou um admin pode publicar um contato." };
  }
  try {
    await prisma.teamMemberContact.updateMany({
      where: { username: target, label },
      data: { public: isPublic },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha ao atualizar a visibilidade." };
  }
}

// ── Member skills (radar chart) ──────────────────────────────────────────────

/** Skills (0–100 per category) + bio + public profile. Any logged-in member reads. */
export async function getMemberSkills(
  username: string,
): Promise<
  | { ok: true; skills: Record<string, number>; bio: string; profile: MemberProfile; canEdit: boolean }
  | { ok: false; error: string }
> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const target = username.toLowerCase().trim();
  const row = await prisma.memberSkills.findUnique({ where: { username: target } }).catch(() => null);
  const canEdit = g.who.username === target || g.who.role === "admin";
  return {
    ok: true,
    skills: (row?.skills as Record<string, number>) ?? {},
    bio: row?.bio ?? "",
    profile: row
      ? {
          roles: row.roles,
          territory: row.territory,
          location: row.location,
          languages: row.languages,
          since: row.since,
        }
      : EMPTY_PROFILE,
    canEdit,
  };
}

/** Save a member's skills + bio — allowed for the member themselves or an admin. */
export async function setMemberSkills(
  username: string,
  skills: Record<string, number>,
  bio?: string,
  profile?: Partial<MemberProfile>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await viewerGate();
  if (!g.ok) return g;
  const target = username.toLowerCase().trim();
  if (g.who.username !== target && g.who.role !== "admin") {
    return { ok: false, error: "Só o próprio membro ou um admin pode editar os skills." };
  }
  const clean = sanitizeSkills(skills);
  const cleanBio = (bio ?? "").trim().slice(0, 600);
  const p = sanitizeProfile(profile ?? {});
  try {
    await prisma.memberSkills.upsert({
      where: { username: target },
      create: { username: target, skills: clean, bio: cleanBio, ...p, updatedBy: g.who.username },
      update: { skills: clean, bio: cleanBio, ...p, updatedBy: g.who.username },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao salvar." };
  }
}

// ---------------------------------------------------------------------------
// Funcionário da Semana — weekly MVP, derived live from GitHub (NO per-action
// logging, no DB writes). Counts issues/PRs CLOSED in the last 7 days, credited
// to their assignees, weighted by the card's fire priority. Cached in memory.
// ---------------------------------------------------------------------------

export type WeeklyMvp = {
  /** Portal username if the GitHub login maps to a member, else null. */
  username: string | null;
  login: string;
  avatarUrl: string;
  /** Tasks completed (closed) in the window. */
  done: number;
  /** Score: each task = 1 + its fire priority (0–5), so hard tasks weigh more. */
  points: number;
  /** A few completed task titles, for the poster. */
  titles: string[];
};

type WeeklyMvpResult =
  | { ok: true; winner: WeeklyMvp | null; ranking: WeeklyMvp[]; since: string }
  | { ok: false; error: string };

const _mvpCache = new Map<string, { data: WeeklyMvpResult; expires: number }>();
const MVP_TTL_MS = 30 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ghNorm = (s: string) =>
  s.trim().toLowerCase().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");

export async function getWeeklyMvp(): Promise<WeeklyMvpResult> {
  const g = await viewerGate();
  if (!g.ok) return g;

  const cacheKey = g.project.slug;
  const cached = _mvpCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  try {
    const { fetchGitHubProject } = await import("@/lib/github-project");
    const cutoff = Date.now() - WEEK_MS;
    const since = new Date(cutoff).toISOString();

    // GitHub login → portal username (from the team's GitHub contacts).
    const contacts = await prisma.teamMemberContact
      .findMany({ where: { label: "GitHub" }, select: { username: true, value: true } })
      .catch(() => [] as { username: string; value: string }[]);
    const loginToUser = new Map<string, string>();
    for (const c of contacts) {
      const l = ghNorm(c.value);
      if (l) loginToUser.set(l, c.username.toLowerCase());
    }

    // Which boards to scan: this project's own, or every portal's on the SOPA hub.
    const boards = g.project.githubProject
      ? [g.project]
      : g.project.kanbanAggregate
        ? getAllProjects().filter((p) => p.githubProject)
        : [];

    const seen = new Set<string>();
    type Done = { id: string; assignees: { login: string; avatarUrl: string }[]; title: string };
    const completed: Done[] = [];
    for (const p of boards) {
      const key = `${p.githubProject!.org}#${p.githubProject!.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const board = await fetchGitHubProject(p).catch(() => null);
      if (!board || !board.ok) continue;
      for (const col of board.columns) {
        for (const it of col.items) {
          if (it.state === "closed" && it.closedAt && new Date(it.closedAt).getTime() >= cutoff && it.assignees.length) {
            completed.push({ id: it.id, assignees: it.assignees, title: it.title });
          }
        }
      }
    }

    // Fire-priority weights for the completed cards.
    const meta = await loadCardMeta(completed.map((c) => c.id));

    const byLogin = new Map<string, WeeklyMvp>();
    for (const c of completed) {
      const weight = 1 + (meta.get(c.id)?.firePriority ?? 0);
      for (const a of c.assignees) {
        const login = a.login.toLowerCase();
        let row = byLogin.get(login);
        if (!row) {
          row = { username: loginToUser.get(login) ?? null, login, avatarUrl: a.avatarUrl, done: 0, points: 0, titles: [] };
          byLogin.set(login, row);
        }
        row.done += 1;
        row.points += weight;
        if (row.titles.length < 4) row.titles.push(c.title);
      }
    }

    const ranking = [...byLogin.values()].sort((a, b) => b.points - a.points || b.done - a.done);
    const result: WeeklyMvpResult = { ok: true, winner: ranking[0] ?? null, ranking, since };
    _mvpCache.set(cacheKey, { data: result, expires: Date.now() + MVP_TTL_MS });
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
