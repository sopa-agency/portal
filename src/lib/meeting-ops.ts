import "server-only";
import { prisma } from "@/lib/prisma";
import type { ProjectConfig } from "@/projects/types";
import type { MeetingActionItem } from "@/lib/meeting-actions";
import { parseActionItems, githubLoginsByUsername } from "@/lib/meeting-actions";

// Shared meeting/occurrence operations: AI extraction, Kanban card creation,
// and ata markdown. Kept provider-agnostic of WHERE the ata is stored (Meeting
// row or MeetingOccurrence) so both call the exact same logic.

/** Extract a summary + structured action items from a transcript/ata via the agent. */
export async function extractAtaFromText(
  project: ProjectConfig,
  source: string,
  instruction?: string,
): Promise<{ ok: true; summary: string; actionItems: MeetingActionItem[] } | { ok: false; error: string }> {
  const { getAllProjects } = await import("@/projects/index");
  const { getTeamRoster } = await import("@/lib/team-roster");
  const projects = getAllProjects();
  const roster = await getTeamRoster(project).catch(() => []);
  const slugList = projects.map((p) => `${p.slug} (${p.name})`).join(", ");
  const userList = roster.map((r) => r.username).join(", ");
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Você é o secretário da agência SOPA. A partir do texto de uma reunião (transcrição automática — pode ter erros de grafia em nomes/termos), produza (1) uma ATA em markdown e (2) a lista de AÇÕES estruturadas.

${instruction?.trim() ? `Instrução extra: ${instruction.trim()}\n` : ""}Data de hoje: ${today}
Projetos válidos (use o SLUG): ${slugList}
Usuários válidos (use exatamente um destes como "owner", ou null): ${userList || "(nenhum)"}

Regras para as ações:
- "project": o slug do projeto dono da ação (um da lista) ou "" se transversal/indefinido.
- "owner": o username do responsável (um da lista) ou null. Nunca invente nome.
- "priority": 1..5 (5 = mais urgente/"gritando"), ou 0 se indefinido.
- "deadline": "yyyy-mm-dd" só se a reunião indicar prazo claro; senão null.
- "text": uma linha objetiva, no imperativo. Sem duplicar ações.

Responda APENAS com JSON válido, sem texto fora dele:
{"summary":"<ata em markdown, com TL;DR, decisões e resumo por tema>","actionItems":[{"text":"...","project":"gnars","owner":"r4topunk","priority":5,"deadline":null}]}

Texto da reunião:
"""
${source.slice(0, 48000)}
"""`;

  let raw: string;
  try {
    const { callOpenClaw } = await import("@/lib/openclaw-gateway");
    raw = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: 180000 });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao chamar a IA." };
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "A IA não retornou JSON. Tente de novo." };
  let parsed: { summary?: string; actionItems?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: "JSON inválido retornado pela IA. Tente de novo." };
  }

  const validSlugs = new Set(projects.map((p) => p.slug));
  const validUsers = new Set(roster.map((r) => r.username.toLowerCase()));
  const cleaned = parseActionItems(parsed.actionItems).map((it) => ({
    ...it,
    project: validSlugs.has(it.project) ? it.project : "",
    owner: it.owner && validUsers.has(it.owner) ? it.owner : null,
  }));
  const { sanitizeForDb } = await import("@/lib/sanitize");
  return { ok: true, summary: parsed.summary ? sanitizeForDb(parsed.summary).slice(0, 100000) : "", actionItems: cleaned };
}

/**
 * Create Kanban cards for the given action items on each item's target board.
 * Mutates the items in place (sets cardItemId). Idempotent — skips items that
 * already have a cardItemId. Returns a per-item result list.
 */
export async function createCardsForItems(
  items: MeetingActionItem[],
  opts: { onlyIds?: string[]; label: string; when: string; username: string; token: string | undefined },
): Promise<{ text: string; project: string; ok: boolean; error?: string }[]> {
  const only = opts.onlyIds && opts.onlyIds.length ? new Set(opts.onlyIds) : null;
  const pending = items.filter((it) => !it.cardItemId && it.project && (!only || only.has(it.id)));
  if (!pending.length) return [];

  const {
    fetchGitHubProject, resolveGitHubToken, addDraftIssue, setItemStatus, setDraftAssignees, resolveUserIds,
  } = await import("@/lib/github-project");
  const { getAllProjects } = await import("@/projects/index");
  const { verifySession } = await import("@/lib/team-access");

  const loginByUser = await githubLoginsByUsername();
  const projects = getAllProjects();
  const byId = new Map(items.map((it) => [it.id, it]));

  const bySlug = new Map<string, MeetingActionItem[]>();
  for (const it of pending) {
    if (!bySlug.has(it.project)) bySlug.set(it.project, []);
    bySlug.get(it.project)!.push(it);
  }

  const results: { text: string; project: string; ok: boolean; error?: string }[] = [];
  for (const [slug, group] of bySlug) {
    const target = projects.find((p) => p.slug === slug);
    const fail = (error: string) => group.forEach((it) => results.push({ text: it.text, project: slug, ok: false, error }));
    if (!target || !target.githubProject) { fail("sem board configurado"); continue; }
    const allowed = await verifySession(opts.token, target);
    if (!allowed) { fail("sem acesso a este portal"); continue; }
    const ghToken = resolveGitHubToken(target);
    if (!ghToken) { fail("GITHUB_TOKEN ausente"); continue; }
    const board = await fetchGitHubProject(target);
    if (!board.ok) { fail(board.error); continue; }
    const startCol = board.columns.find((c) => c.optionId && /todo|to do|backlog|triage|ready|próxim|proxim|icebox/i.test(c.name));

    for (const it of group) {
      const owner = it.owner ?? undefined;
      const login = owner ? loginByUser.get(owner) : undefined;
      const bodyLines = [
        `_Da reunião SOPA "${opts.label}" (${opts.when})._`,
        owner ? `\n**Dono:** @${owner}${login ? ` (github: @${login})` : ""}` : "",
      ].filter(Boolean);
      const draft = await addDraftIssue({ token: ghToken, projectId: board.projectId, title: it.text.slice(0, 250), body: bodyLines.join("\n") });
      if (!draft.ok) { results.push({ text: it.text, project: slug, ok: false, error: draft.error }); continue; }

      if (it.priority || it.deadline || login) {
        await prisma.cardPriority
          .upsert({
            where: { itemId: draft.itemId },
            create: { itemId: draft.itemId, priority: it.priority || 0, deadline: it.deadline ? new Date(it.deadline) : null, owner: login ?? null, projectSlug: slug, updatedBy: opts.username },
            update: { priority: it.priority || 0, deadline: it.deadline ? new Date(it.deadline) : null, owner: login ?? null, updatedBy: opts.username },
          })
          .catch(() => {});
      }
      if (login && draft.contentId) {
        const ids = await resolveUserIds(ghToken, [login]).catch(() => ({}) as Record<string, string>);
        const uid = ids[login.toLowerCase()];
        if (uid) await setDraftAssignees({ token: ghToken, draftId: draft.contentId, assigneeIds: [uid] }).catch(() => {});
      }
      if (startCol?.optionId && board.statusFieldId) {
        await setItemStatus({ token: ghToken, projectId: board.projectId, itemId: draft.itemId, fieldId: board.statusFieldId, optionId: startCol.optionId }).catch(() => {});
      }
      const stored = byId.get(it.id);
      if (stored) stored.cardItemId = draft.itemId;
      results.push({ text: it.text, project: slug, ok: true });
    }
  }
  return results;
}

/** Render an ata + action items as HackMD-ready markdown. */
export function buildAtaMarkdown(m: {
  title: string; when: Date; summary: string | null; notes?: string | null; actionItems: MeetingActionItem[];
}): string {
  const when = m.when.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const parts: string[] = [`# ${m.title}`, `> Reunião SOPA · ${when}`, ""];
  parts.push(m.summary?.trim() || m.notes?.trim() || "_Sem resumo._");
  if (m.actionItems.length) {
    parts.push("", "## Ações", "");
    const bySlug = new Map<string, MeetingActionItem[]>();
    for (const it of m.actionItems) {
      const k = it.project || "geral";
      if (!bySlug.has(k)) bySlug.set(k, []);
      bySlug.get(k)!.push(it);
    }
    for (const [slug, group] of bySlug) {
      parts.push(`### ${slug}`);
      for (const it of group) {
        const meta = [it.owner ? `@${it.owner}` : "", it.priority ? "🔥".repeat(it.priority) : "", it.deadline ? `⏰${it.deadline}` : ""].filter(Boolean).join(" ");
        parts.push(`- [${it.done ? "x" : " "}] ${it.text}${meta ? ` — ${meta}` : ""}`);
      }
      parts.push("");
    }
  }
  return parts.join("\n");
}
