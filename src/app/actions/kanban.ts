"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getAllProjects } from "@/projects/index";
import { resolveGitHubToken, fetchGitHubProject, fetchAssignableUsers } from "@/lib/github-project";
import { prisma } from "@/lib/prisma";

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

  const repos = board.ok
    ? [
        ...new Map(
          board.columns
            .flatMap((c) => c.items)
            .map((i) => i.url?.match(/github\.com\/([^/]+)\/([^/]+)\//))
            .filter((m): m is RegExpMatchArray => !!m)
            .map((m) => [`${m[1]}/${m[2]}`.toLowerCase(), { owner: m[1], name: m[2] }]),
        ).values(),
      ]
    : [];
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
