import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { fetchGitHubProject } from "@/lib/github-project";

// Compact GitHub Project (kanban) snapshot for the morning briefing prompt.
// Lean by design: per-column counts + the actionable items (In progress / In
// review / Ready), capped — Done is summarised as a count, Backlog as a count.
// Returns "" when the project has no board or the fetch fails (best-effort).

const ACTIONABLE = ["in progress", "in review", "ready", "in review/testing", "testing"];
const ITEMS_PER_COLUMN = 6;

export async function getProjectKanbanContext(project: ProjectConfig): Promise<string> {
  if (!project.githubProject) return "";
  try {
    const board = await fetchGitHubProject(project);
    if (!board.ok) return "";

    const counts = board.columns
      .map((c) => `${c.name} ${c.items.length}`)
      .join(" · ");

    const blocks: string[] = [`Board "${board.title}" — ${counts}`];

    for (const col of board.columns) {
      const lower = col.name.toLowerCase();
      if (!ACTIONABLE.some((a) => lower.includes(a))) continue;
      if (col.items.length === 0) continue;
      const lines = col.items.slice(0, ITEMS_PER_COLUMN).map((it) => {
        const ref = it.number != null ? `#${it.number}` : it.type;
        const who = it.assignees.length
          ? ` (${it.assignees.map((a) => `@${a.login}`).join(", ")})`
          : "";
        const labels = it.labels.length
          ? ` [${it.labels.map((l) => l.name).join(", ")}]`
          : "";
        return `- ${ref} ${it.title.slice(0, 90)}${who}${labels}`;
      });
      const more = col.items.length > ITEMS_PER_COLUMN ? `\n  …+${col.items.length - ITEMS_PER_COLUMN} more` : "";
      blocks.push(`${col.name}:\n${lines.join("\n")}${more}`);
    }

    return blocks.join("\n");
  } catch {
    return "";
  }
}
