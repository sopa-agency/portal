import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { fetchGitHubProject } from "@/lib/github-project";
import { loadCardMeta } from "@/lib/card-meta";
import { compareByPriority } from "@/lib/kanban-priority";

// Compact GitHub Project (kanban) snapshot for the morning briefing prompt.
// Lean by design: per-column counts + the actionable items (In progress / In
// review / Ready), capped — Done is summarised as a count, Backlog as a count.
// Returns "" when the project has no board or the fetch fails (best-effort).

const ACTIONABLE = ["in progress", "in review", "ready", "in review/testing", "testing"];
const ITEMS_PER_COLUMN = 6;

// Short cache so when both briefing agents assemble in the same cron tick they
// share one board fetch instead of hitting GitHub twice.
const ctxCache = new Map<string, { data: string; expires: number }>();

export async function getProjectKanbanContext(project: ProjectConfig): Promise<string> {
  if (!project.githubProject) return "";
  const cached = ctxCache.get(project.slug);
  if (cached && Date.now() < cached.expires) return cached.data;
  try {
    const board = await fetchGitHubProject(project);
    if (!board.ok) return "";

    // Merge portal-owned fire priority (1🔥..5🔥) + deadline so the briefing can
    // order Próximas ações by priority and flag overdue/soon deadlines.
    const meta = await loadCardMeta(board.columns.flatMap((c) => c.items).map((i) => i.id));
    for (const col of board.columns) {
      for (const it of col.items) {
        const m = meta.get(it.id);
        if (m) {
          it.firePriority = m.firePriority;
          it.deadline = m.deadline;
        }
      }
    }
    const today = new Date().toISOString().slice(0, 10);

    const counts = board.columns
      .map((c) => `${c.name} ${c.items.length}`)
      .join(" · ");

    const blocks: string[] = [
      `Board "${board.title}" — ${counts}`,
      "Prioridade = pontos de foguinho (🔥1 baixa .. 🔥5 alta). Ordene as Próximas ações por prioridade (🔥 maior primeiro), depois por deadline mais próximo; destaque deadlines vencidos/próximos.",
    ];

    for (const col of board.columns) {
      const lower = col.name.toLowerCase();
      if (!ACTIONABLE.some((a) => lower.includes(a))) continue;
      if (col.items.length === 0) continue;
      const sorted = [...col.items].sort(compareByPriority);
      const lines = sorted.slice(0, ITEMS_PER_COLUMN).map((it) => {
        const ref = it.number != null ? `#${it.number}` : it.type;
        const who = it.assignees.length
          ? ` (${it.assignees.map((a) => `@${a.login}`).join(", ")})`
          : "";
        const labels = it.labels.length
          ? ` [${it.labels.map((l) => l.name).join(", ")}]`
          : "";
        const fire = it.firePriority ? ` 🔥${it.firePriority}` : "";
        const due = it.deadline ? ` ⏰${it.deadline}${it.deadline < today ? "(atrasado)" : it.deadline === today ? "(hoje)" : ""}` : "";
        return `- ${ref}${fire} ${it.title.slice(0, 90)}${who}${labels}${due}`;
      });
      const more = col.items.length > ITEMS_PER_COLUMN ? `\n  …+${col.items.length - ITEMS_PER_COLUMN} more` : "";
      blocks.push(`${col.name}:\n${lines.join("\n")}${more}`);
    }

    const out = blocks.join("\n");
    ctxCache.set(project.slug, { data: out, expires: Date.now() + 5 * 60_000 });
    return out;
  } catch {
    return "";
  }
}
