"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject, getAllProjects } from "@/projects/index";
import { resolveGitHubToken, fetchGitHubProject, fetchAssignableUsers } from "@/lib/github-project";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { prisma } from "@/lib/prisma";

/**
 * Send an issue to the project's coding agent: solve it on a branch and open a
 * PR (never merge). Returns the PR URL for the user to review. Long-running —
 * the agent does real git work via the gateway.
 */
export async function solveIssueWithAgent(input: { title: string; body?: string; url?: string }): Promise<
  { ok: true; prUrl: string | null; result: string } | { ok: false; error: string }
> {
  try {
    const project = await getActiveProject();
    const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };
    if (!input.title?.trim()) return { ok: false, error: "Issue sem título." };

    const prompt = [
      "You are this project's coding agent, called from the Kanban to resolve a GitHub issue.",
      "Solve the issue end-to-end ON A NEW BRANCH and open a Pull Request. Do NOT merge or push to the default branch.",
      "Make the real code change, commit, push the branch, open the PR.",
      "Return the PR URL on its own line (https://github.com/<owner>/<repo>/pull/<n>). If you can't, explain the exact blocker.",
      "",
      `Issue: ${input.title.trim()}`,
      input.url ? `URL: ${input.url}` : "",
      input.body?.trim() ? `\nBody:\n${input.body.trim().slice(0, 6000)}` : "",
    ].filter(Boolean).join("\n");

    const raw = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: 280_000 });
    if (!raw) return { ok: false, error: "Resposta vazia do agente." };
    const prUrl = raw.match(/https?:\/\/github\.com\/[^\s)"']+\/pull\/\d+/)?.[0] ?? null;
    return { ok: true, prUrl, result: raw };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (/abort|timeout|timed out/i.test(m)) {
      return { ok: false, error: "O agente passou do tempo limite aqui, mas pode ainda estar trabalhando. Verifique os PRs do repo em alguns minutos antes de tentar de novo." };
    }
    return { ok: false, error: m };
  }
}

// ── Portal-side card comments (work on any card, incl. drafts) ──────────────
export type CardNote = { id: string; author: string; body: string; createdAt: string };

async function noteGate(projectSlug: string) {
  const project = getAllProjects().find((p) => p.slug === projectSlug);
  if (!project) return { ok: false as const, error: "Portal inválido." };
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Sem acesso a esse portal." };
  return { ok: true as const, username: session.username };
}

export async function listCardNotes(projectSlug: string, cardKey: string): Promise<
  { ok: true; notes: CardNote[] } | { ok: false; error: string }
> {
  const g = await noteGate(projectSlug);
  if (!g.ok) return g;
  const rows = await prisma.cardNote
    .findMany({ where: { projectSlug, cardKey }, orderBy: { createdAt: "asc" } })
    .catch(() => []);
  return { ok: true, notes: rows.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: r.createdAt.toISOString() })) };
}

export async function addCardNote(projectSlug: string, cardKey: string, body: string): Promise<
  { ok: true; note: CardNote } | { ok: false; error: string }
> {
  const g = await noteGate(projectSlug);
  if (!g.ok) return g;
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, error: "Comentário vazio." };
  if (!cardKey.trim()) return { ok: false, error: "Card inválido." };
  const r = await prisma.cardNote.create({ data: { projectSlug, cardKey, author: g.username, body: text } });
  return { ok: true, note: { id: r.id, author: r.author, body: r.body, createdAt: r.createdAt.toISOString() } };
}

export async function deleteCardNote(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = await prisma.cardNote.findUnique({ where: { id } });
  if (!note) return { ok: false, error: "Nota não encontrada." };
  const g = await noteGate(note.projectSlug);
  if (!g.ok) return g;
  if (note.author !== g.username) return { ok: false, error: "Só o autor pode apagar." };
  await prisma.cardNote.delete({ where: { id } });
  return { ok: true };
}

export type Assignee = { login: string; avatarUrl: string; username: string | null };

function normalizeGithubLogin(value: string): string {
  return value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "").trim();
}

/**
 * Assignable users for a project's board — repo collaborators (GitHub's own
 * picker set) enriched with the portal username when a team card maps the login,
 * plus team-card-only logins as a fallback. Used by the SOPA aggregated board to
 * assign tasks on another portal's board (gated by a session on that project).
 */
export async function getProjectAssignees(projectSlug: string): Promise<
  { ok: true; assignees: Assignee[] } | { ok: false; error: string }
> {
  const project = getAllProjects().find((p) => p.slug === projectSlug);
  if (!project) return { ok: false, error: "Portal inválido." };
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Sem acesso a esse portal." };

  const token = resolveGitHubToken(project);
  const [board, contacts] = await Promise.all([
    fetchGitHubProject(project),
    prisma.teamMemberContact.findMany({ where: { projectSlug, label: "GitHub" }, select: { username: true, value: true } }).catch(() => []),
  ]);

  const teamGithub: { username: string; login: string }[] = [];
  const seenTeam = new Set<string>();
  for (const r of contacts) {
    const login = normalizeGithubLogin(r.value);
    if (!login || seenTeam.has(login.toLowerCase())) continue;
    seenTeam.add(login.toLowerCase());
    teamGithub.push({ username: r.username, login });
  }

  const repos = [
    ...new Map(
      [
        // Configured repos — collaborators stay assignable even on draft-only boards.
        ...(project.repos ?? []).map((r) => r.match(/^([^/]+)\/([^/]+)$/)),
        ...(board.ok
          ? board.columns.flatMap((c) => c.items).map((i) => i.url?.match(/github\.com\/([^/]+)\/([^/]+)\//))
          : []),
      ]
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [`${m[1]}/${m[2]}`.toLowerCase(), { owner: m[1], name: m[2] }]),
    ).values(),
  ];
  const collaborators = token && repos.length ? await fetchAssignableUsers(token, repos).catch(() => []) : [];

  const usernameByLogin = new Map(teamGithub.map((t) => [t.login.toLowerCase(), t.username]));
  const byLogin = new Map<string, Assignee>();
  for (const c of collaborators) {
    byLogin.set(c.login.toLowerCase(), { login: c.login, avatarUrl: c.avatarUrl, username: usernameByLogin.get(c.login.toLowerCase()) ?? null });
  }
  for (const t of teamGithub) {
    if (!byLogin.has(t.login.toLowerCase())) {
      byLogin.set(t.login.toLowerCase(), { login: t.login, avatarUrl: `https://github.com/${encodeURIComponent(t.login)}.png?size=48`, username: t.username });
    }
  }
  const assignees = [...byLogin.values()].sort((a, b) => {
    if (!!a.username !== !!b.username) return a.username ? -1 : 1;
    return a.login.localeCompare(b.login);
  });
  return { ok: true, assignees };
}

export type TaskDeadline = {
  itemId: string;
  title: string;
  deadline: string; // yyyy-mm-dd
  firePriority?: number;
  board?: string;
  projectSlug?: string;
};

/** Open cards that have a deadline — for the agenda/calendar. Aggregates across
 *  portals on the SOPA hub; otherwise just the active project's board. */
export async function listTaskDeadlines(): Promise<
  { ok: true; deadlines: TaskDeadline[] } | { ok: false; error: string }
> {
  try {
    const project = await getActiveProject();
    const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };
    const done = (col: string, state?: string) => /done|closed|conclu|complete|finaliz/i.test(col) || state === "closed";
    const out: TaskDeadline[] = [];

    if (!project.githubProject && project.kanbanAggregate) {
      const { fetchAggregatedBoards } = await import("@/lib/github-project");
      const { columns } = await fetchAggregatedBoards();
      for (const col of columns)
        for (const it of col.items)
          if (it.deadline && !done(col.name, it.state))
            out.push({ itemId: it.id, title: it.title, deadline: it.deadline, firePriority: it.firePriority, board: it.board, projectSlug: it.projectSlug });
    } else if (project.githubProject) {
      const board = await fetchGitHubProject(project);
      if (board.ok) {
        const { loadCardMeta } = await import("@/lib/card-meta");
        const meta = await loadCardMeta(board.columns.flatMap((c) => c.items).map((i) => i.id));
        for (const col of board.columns)
          for (const it of col.items) {
            const m = meta.get(it.id);
            if (m?.deadline && !done(col.name, it.state))
              out.push({ itemId: it.id, title: it.title, deadline: m.deadline, firePriority: m.firePriority, board: board.title || project.name, projectSlug: project.slug });
          }
      }
    }

    out.sort((a, b) => a.deadline.localeCompare(b.deadline) || (b.firePriority ?? 0) - (a.firePriority ?? 0));
    return { ok: true, deadlines: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao carregar deadlines." };
  }
}
