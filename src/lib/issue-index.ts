import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { fetchGitHubProject } from "@/lib/github-project";
import { loadCardMeta } from "@/lib/card-meta";

// Number → card info map for a project's board, so the morning briefing can
// turn a bare "#145" reference into a hover card with the task's real title,
// status, assignees and priority (instead of just a link to GitHub).

export type IssueRef = {
  number: number;
  title: string;
  type: "issue" | "pr" | "draft";
  /** OPEN / CLOSED (issues/PRs); absent for drafts. */
  state?: string;
  merged?: boolean;
  url?: string;
  /** Board column the card currently sits in (its status). */
  column?: string;
  assignees: { login: string; avatarUrl: string }[];
  labels: { name: string; color: string }[];
  firePriority?: number;
  deadline?: string;
  owner?: string;
};

export type IssueIndex = Record<number, IssueRef>;

export async function getProjectIssueIndex(project: ProjectConfig): Promise<IssueIndex> {
  if (!project.githubProject) return {};
  try {
    const board = await fetchGitHubProject(project);
    if (!board.ok) return {};
    const flat = board.columns.flatMap((c) => c.items.map((it) => ({ it, column: c.name })));
    const meta = await loadCardMeta(flat.map(({ it }) => it.id));
    const idx: IssueIndex = {};
    for (const { it, column } of flat) {
      if (it.number == null) continue;
      const m = meta.get(it.id);
      idx[it.number] = {
        number: it.number,
        title: it.title,
        type: it.type,
        state: it.state,
        merged: it.merged,
        url: it.url,
        column,
        assignees: it.assignees,
        labels: it.labels.map((l) => ({ name: l.name, color: l.color })),
        firePriority: m?.firePriority,
        deadline: m?.deadline,
        owner: m?.owner,
      };
    }
    return idx;
  } catch {
    return {};
  }
}
