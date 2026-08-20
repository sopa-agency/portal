import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { prisma } from "@/lib/prisma";
import { parseActionItems } from "@/lib/meeting-actions";
import { getDoneCardItemIds } from "@/lib/kanban-context";
import { getAllProjects } from "@/projects";

// Compact recent-meetings snapshot for the morning-briefing prompt. Meetings
// live on the SOPA portal, but their action items are tagged with a target
// project slug — so a SkateHive briefing surfaces the SkateHive-tagged items
// (plus transversal "" ones for the SOPA hub). Lean: last meeting's summary
// head + still-open action items with owner/priority/deadline. Best-effort ("").

const MAX_MEETINGS = 4;
const MAX_ITEMS = 12;

export type OpenMeetingAction = {
  id: string;
  text: string;
  project: string;
  owner: string | null;
  priority: number;
  deadline: string | null;
  carded: boolean;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string; // yyyy-mm-dd
};

/**
 * Union of finished card ids across every project referenced by the carded
 * action items in `rows`. One board fetch per distinct target project (cached),
 * so a completed card marks its source action item done regardless of which
 * portal's board it lives on.
 */
async function collectDoneCardIds(
  rows: { actionItems: unknown }[],
): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const m of rows) {
    for (const it of parseActionItems(m.actionItems)) {
      if (!it.done && it.cardItemId && it.project) slugs.add(it.project);
    }
  }
  const doneIds = new Set<string>();
  if (!slugs.size) return doneIds;
  const bySlug = new Map(getAllProjects().map((p) => [p.slug, p]));
  await Promise.all(
    [...slugs].map(async (slug) => {
      const p = bySlug.get(slug);
      if (!p) return;
      for (const id of await getDoneCardItemIds(p)) doneIds.add(id);
    }),
  );
  return doneIds;
}

/**
 * Structured open (not-done) action items from recent SOPA meetings — powers
 * the Coordenação panel on the SOPA home. Newest meetings first, then by
 * priority. `take` bounds how many meetings we scan.
 */
export async function getOpenMeetingActions(take = 8): Promise<OpenMeetingAction[]> {
  try {
    const rows = await prisma.meetingOccurrence.findMany({
      where: { projectSlug: "sopa" },
      orderBy: { occurredOn: "desc" },
      take,
      include: { meeting: { select: { title: true } } },
    });
    // Treat an action as done if its linked card is finished on its board,
    // not just when the ata's own `done` flag was toggled — moving the card to
    // Done never writes back, so this read-time cross-reference keeps the
    // Coordenação panel from re-surfacing already-shipped work.
    const doneCardIds = await collectDoneCardIds(rows);

    const out: OpenMeetingAction[] = [];
    for (const m of rows) {
      const date = m.occurredOn.toISOString().slice(0, 10);
      for (const it of parseActionItems(m.actionItems)) {
        if (it.done || (it.cardItemId && doneCardIds.has(it.cardItemId))) continue;
        out.push({
          id: it.id,
          text: it.text,
          project: it.project,
          owner: it.owner,
          priority: it.priority,
          deadline: it.deadline,
          carded: !!it.cardItemId,
          meetingId: m.meetingId,
          meetingTitle: m.meeting.title,
          meetingDate: date,
        });
      }
    }
    return out.sort(
      (a, b) =>
        b.meetingDate.localeCompare(a.meetingDate) ||
        b.priority - a.priority ||
        (a.deadline ?? "~").localeCompare(b.deadline ?? "~"),
    );
  } catch {
    return [];
  }
}

export async function getProjectMeetingsContext(project: ProjectConfig): Promise<string> {
  try {
    const rows = await prisma.meetingOccurrence.findMany({
      where: { projectSlug: "sopa" },
      orderBy: { occurredOn: "desc" },
      take: MAX_MEETINGS,
      include: { meeting: { select: { title: true } } },
    });
    if (!rows.length) return "";

    const relevant = (slug: string) => slug === project.slug || (project.slug === "sopa" && slug === "");
    // Cards finished on the board count as done even if the ata flag wasn't
    // toggled — see collectDoneCardIds / getOpenMeetingActions.
    const doneCardIds = await collectDoneCardIds(rows);

    type Line = { text: string; priority: number; deadline: string | null; owner: string | null; meeting: string };
    const open: Line[] = [];
    for (const m of rows) {
      const when = m.occurredOn.toISOString().slice(0, 10);
      for (const it of parseActionItems(m.actionItems)) {
        if (it.done || (it.cardItemId && doneCardIds.has(it.cardItemId)) || !relevant(it.project)) continue;
        open.push({ text: it.text, priority: it.priority, deadline: it.deadline, owner: it.owner, meeting: `${m.meeting.title} (${when})` });
      }
    }
    if (!open.length && !rows[0]?.summary) return "";

    open.sort((a, b) => b.priority - a.priority || (a.deadline ?? "~").localeCompare(b.deadline ?? "~"));
    const today = new Date().toISOString().slice(0, 10);

    const blocks: string[] = [];
    const last = rows[0];
    const lastWhen = last.occurredOn.toISOString().slice(0, 10);
    if (last.summary) {
      blocks.push(`Última reunião: ${last.meeting.title} (${lastWhen}).`);
      blocks.push(last.summary.slice(0, 1200));
    }
    if (open.length) {
      blocks.push("", `Ações em aberto para ${project.name} (das reuniões — cobre o que ainda não foi feito):`);
      for (const l of open.slice(0, MAX_ITEMS)) {
        const fire = l.priority ? ` 🔥${l.priority}` : "";
        const due = l.deadline ? ` ⏰${l.deadline}${l.deadline < today ? "(atrasado)" : l.deadline === today ? "(hoje)" : ""}` : "";
        const who = l.owner ? ` (@${l.owner})` : "";
        blocks.push(`- ${l.text}${who}${fire}${due} — ${l.meeting}`);
      }
      if (open.length > MAX_ITEMS) blocks.push(`  …+${open.length - MAX_ITEMS} mais`);
    }
    return blocks.join("\n");
  } catch {
    return "";
  }
}
