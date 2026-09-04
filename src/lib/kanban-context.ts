import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { fetchAggregatedBoards, fetchGitHubProject, type AggregatedItem, type KanbanResult } from "@/lib/github-project";
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

// A card is "finished" when it sits in a Done-ish column OR is closed/merged.
// Kept in sync with the same notion in team-admin.ts (getMemberTasks).
const DONE_COLUMN = /done|conclu|complete|shipped|archiv|encerrad|fechad|✅/i;

export type AssignedTasksContext = {
  text: string;
  total: number;
  errors: string[];
};

function isFinished(column: string, item: AggregatedItem): boolean {
  return DONE_COLUMN.test(column) || item.merged === true || (item.state ?? "").toUpperCase() === "CLOSED";
}

function belongsToIdentity(project: ProjectConfig, item: AggregatedItem): boolean {
  const identity = project.taskIdentity;
  if (!identity) return false;
  if (identity.includeOwnBoard && item.projectSlug === project.slug) return true;
  const logins = new Set(identity.logins.map((login) => login.trim().toLowerCase()).filter(Boolean));
  if (item.owner && logins.has(item.owner.toLowerCase())) return true;
  return item.assignees.some((assignee) => logins.has(assignee.login.toLowerCase()));
}

function compactTitle(value: string, max = 140): string {
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

/**
 * Every open task that belongs to the configured person across all registered
 * portal boards. Personal-board cards count even without an explicit assignee;
 * cards elsewhere need a matching GitHub assignee or portal-owned owner.
 */
export async function getAssignedTasksAcrossPortalsContext(project: ProjectConfig): Promise<AssignedTasksContext> {
  if (!project.taskIdentity) return { text: "", total: 0, errors: [] };

  const aggregated = await fetchAggregatedBoards();
  const tasks: { status: string; item: AggregatedItem }[] = [];
  for (const column of aggregated.columns) {
    for (const item of column.items) {
      if (isFinished(column.name, item)) continue;
      if (belongsToIdentity(project, item)) tasks.push({ status: column.name, item });
    }
  }
  tasks.sort((a, b) => compareByPriority(a.item, b.item));

  const today = new Date().toISOString().slice(0, 10);
  const lines = tasks.map(({ status, item }) => {
    const fire = item.firePriority ? ` 🔥${item.firePriority}` : "";
    const due = item.deadline
      ? ` ⏰${item.deadline}${item.deadline < today ? "(atrasado)" : item.deadline === today ? "(hoje)" : ""}`
      : "";
    const githubPriority = item.priority ? ` prioridade:${item.priority}` : "";
    const owner = item.owner ? ` owner:@${item.owner}` : "";
    const assigned = item.assignees.length ? ` assignees:${item.assignees.map((a) => `@${a.login}`).join(",")}` : "";
    const link = item.url ? ` ${item.url}` : "";
    return `- [${item.board} · ${status}]${fire}${due}${githubPriority} ${compactTitle(item.title)}${owner}${assigned}${link}`;
  });

  const byPortal = new Map<string, number>();
  for (const { item } of tasks) byPortal.set(item.board, (byPortal.get(item.board) ?? 0) + 1);
  const summary = [...byPortal.entries()].map(([board, count]) => `${board} ${count}`).join(" · ");
  const partial = aggregated.errors.length
    ? `\nLEITURA PARCIAL — não consegui ler: ${aggregated.errors.join(" | ")}. Não trate esses portais como zero.`
    : "";
  const text = tasks.length
    ? `Total aberto atribuído ao Vlad: ${tasks.length}${summary ? ` — ${summary}` : ""}\n${lines.join("\n")}${partial}`
    : partial.trim();
  return { text, total: tasks.length, errors: aggregated.errors };
}

/**
 * GitHub Project item node ids whose card is finished on `project`'s board
 * (Done column, or closed/merged issue/PR). Meeting action items carry a
 * `cardItemId` pointing at one of these — so callers can treat an action as
 * done once its linked card lands in Done, without any write-back (always
 * fresh, cheap: the board fetch is shared/cached). Empty set on any failure.
 */
export async function getDoneCardItemIds(project: ProjectConfig): Promise<Set<string>> {
  const done = new Set<string>();
  if (!project.githubProject) return done;
  try {
    const board = await fetchGitHubProject(project);
    if (!board.ok) return done;
    for (const col of board.columns) {
      const colDone = DONE_COLUMN.test(col.name);
      for (const it of col.items) {
        if (colDone || it.merged === true || (it.state ?? "").toUpperCase() === "CLOSED") {
          done.add(it.id);
        }
      }
    }
  } catch {
    /* best-effort */
  }
  return done;
}

export async function getProjectKanbanContext(
  project: ProjectConfig,
  prefetched?: Extract<KanbanResult, { ok: true }>,
): Promise<string> {
  if (!project.githubProject) return "";
  const cached = ctxCache.get(project.slug);
  if (cached && Date.now() < cached.expires) return cached.data;
  try {
    const board = prefetched ?? await fetchGitHubProject(project);
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
