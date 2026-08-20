"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { parseActionItems, type MeetingActionItem, type OccurrenceDTO } from "@/lib/meeting-actions";
import { extractAtaFromText, createCardsForItems, buildAtaMarkdown } from "@/lib/meeting-ops";
import { sanitizeForDb } from "@/lib/sanitize";
import { meetingsCalendarId, attachAtaToOccurrence } from "@/lib/google-calendar";

// Per-occurrence ata layer. Meetings can be weekly (many occurrences) or one-off
// (one). The ata (prose in HackMD, cached here) + structured action items live on
// the occurrence; the Calendar instance's description carries the HackMD link.

async function gate() {
  const project = await getActiveProject();
  if (!project.meetings) return { ok: false as const, error: "Reuniões não habilitadas." };
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, project);
  if (!session) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, username: session.username, token };
}

type OccRow = {
  id: string; meetingId: string; occurredOn: Date; hackmdUrl: string | null;
  transcript: string | null; summary: string | null; actionItems: unknown; googleEventId: string | null;
};
const toDTO = (o: OccRow): OccurrenceDTO => ({
  id: o.id,
  meetingId: o.meetingId,
  occurredOn: o.occurredOn.toISOString(),
  hackmdUrl: o.hackmdUrl,
  transcript: o.transcript,
  summary: o.summary,
  actionItems: parseActionItems(o.actionItems),
  googleEventId: o.googleEventId,
});

async function ownedMeeting(meetingId: string, slug: string) {
  const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
  return m && m.projectSlug === slug ? m : null;
}

/** All occurrences of a meeting, newest first (compact — for the week selector). */
export async function listOccurrences(
  meetingId: string,
): Promise<{ ok: true; occurrences: { id: string; occurredOn: string; hasAta: boolean; actionCount: number; hackmdUrl: string | null }[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!(await ownedMeeting(meetingId, g.project.slug))) return { ok: false, error: "Reunião não encontrada." };
  const rows = await prisma.meetingOccurrence.findMany({ where: { meetingId }, orderBy: { occurredOn: "desc" } });
  return {
    ok: true,
    occurrences: rows.map((r) => ({
      id: r.id,
      occurredOn: r.occurredOn.toISOString(),
      hasAta: !!r.summary,
      actionCount: parseActionItems(r.actionItems).length,
      hackmdUrl: r.hackmdUrl,
    })),
  };
}

/** Get-or-create the occurrence for a given date, returning its full DTO. */
export async function ensureOccurrence(
  meetingId: string,
  occurredOnISO: string,
): Promise<{ ok: true; occurrence: OccurrenceDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const meeting = await ownedMeeting(meetingId, g.project.slug);
  if (!meeting) return { ok: false, error: "Reunião não encontrada." };
  const occurredOn = new Date(occurredOnISO);
  if (isNaN(occurredOn.getTime())) return { ok: false, error: "Data inválida." };
  const row = await prisma.meetingOccurrence.upsert({
    where: { meetingId_occurredOn: { meetingId, occurredOn } },
    create: { meetingId, projectSlug: g.project.slug, occurredOn, createdBy: g.username },
    update: {},
  });
  return { ok: true, occurrence: toDTO(row) };
}

export async function getOccurrence(
  occurrenceId: string,
): Promise<{ ok: true; occurrence: OccurrenceDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.meetingOccurrence.findUnique({ where: { id: occurrenceId } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Ocorrência não encontrada." };
  return { ok: true, occurrence: toDTO(row) };
}

export async function saveOccurrence(
  occurrenceId: string,
  patch: { transcript?: string | null; summary?: string | null; actionItems?: MeetingActionItem[]; hackmdUrl?: string | null },
): Promise<{ ok: true; occurrence: OccurrenceDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.meetingOccurrence.findUnique({ where: { id: occurrenceId } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Ocorrência não encontrada." };
  const updated = await prisma.meetingOccurrence.update({
    where: { id: occurrenceId },
    data: {
      ...(patch.transcript !== undefined ? { transcript: patch.transcript?.trim() || null } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary?.trim() || null } : {}),
      ...(patch.hackmdUrl !== undefined ? { hackmdUrl: patch.hackmdUrl?.trim() || null } : {}),
      ...(patch.actionItems !== undefined ? { actionItems: parseActionItems(patch.actionItems) as unknown as object[] } : {}),
    },
  });
  revalidatePath("/reunioes");
  return { ok: true, occurrence: toDTO(updated) };
}

export async function extractOccurrenceActions(
  occurrenceId: string,
  opts: { source?: string; instruction?: string } = {},
): Promise<{ ok: true; occurrence: OccurrenceDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.meetingOccurrence.findUnique({ where: { id: occurrenceId } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Ocorrência não encontrada." };
  const source = opts.source?.trim() || row.transcript?.trim() || "";
  if (!source) return { ok: false, error: "Cole a transcrição ou a ata antes de extrair as ações." };

  const res = await extractAtaFromText(g.project, source, opts.instruction);
  if (!res.ok) return res;

  const updated = await prisma.meetingOccurrence.update({
    where: { id: occurrenceId },
    data: {
      transcript: opts.source ? sanitizeForDb(source).slice(0, 200000) : row.transcript,
      summary: res.summary || row.summary,
      actionItems: res.actionItems as unknown as object[],
    },
  });
  revalidatePath("/reunioes");
  return { ok: true, occurrence: toDTO(updated) };
}

export async function createCardsFromOccurrence(
  occurrenceId: string,
  itemIds?: string[],
): Promise<{ ok: true; created: number; results: { text: string; project: string; ok: boolean; error?: string }[]; occurrence: OccurrenceDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.meetingOccurrence.findUnique({ where: { id: occurrenceId }, include: { meeting: true } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Ocorrência não encontrada." };

  const items = parseActionItems(row.actionItems);
  const results = await createCardsForItems(items, {
    onlyIds: itemIds,
    label: row.meeting.title,
    when: row.occurredOn.toLocaleDateString("pt-BR"),
    username: g.username,
    token: g.token,
  });
  const updated = await prisma.meetingOccurrence.update({
    where: { id: occurrenceId },
    data: { actionItems: items as unknown as object[] },
  });
  revalidatePath("/reunioes");
  revalidatePath("/kanban");
  return { ok: true, created: results.filter((r) => r.ok).length, results, occurrence: toDTO(updated) };
}

/** Publish/update the occurrence ata to HackMD AND drop the link into the specific
 *  Google Calendar instance's description. */
export async function publishOccurrenceToHackmd(
  occurrenceId: string,
): Promise<{ ok: true; occurrence: OccurrenceDTO; url: string; calendar: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.meetingOccurrence.findUnique({ where: { id: occurrenceId }, include: { meeting: true } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Ocorrência não encontrada." };

  const { hackmdConfigured, createHackmdNote, updateHackmdNote, noteIdFromUrl } = await import("@/lib/hackmd");
  if (!hackmdConfigured()) return { ok: false, error: "HACKMD_API_KEY não configurada no portal." };

  const dateLabel = row.occurredOn.toLocaleDateString("pt-BR");
  const content = buildAtaMarkdown({
    title: `${row.meeting.title} — ${dateLabel}`,
    when: row.occurredOn,
    summary: row.summary,
    notes: row.meeting.notes,
    actionItems: parseActionItems(row.actionItems),
  });
  const noteTitle = `🍲 ${row.meeting.title} — ${row.occurredOn.toISOString().slice(0, 10)}`;

  let url: string;
  try {
    const existingId = noteIdFromUrl(row.hackmdUrl);
    if (existingId) {
      await updateHackmdNote(existingId, content);
      url = `https://hackmd.io/${existingId}`;
    } else {
      const note = await createHackmdNote({ title: noteTitle, content });
      url = note.url;
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao publicar no HackMD." };
  }

  // Drop the link into the specific Calendar instance's description (best-effort).
  let calendar = "sem calendário configurado";
  const calId = meetingsCalendarId(g.project.agent.gatewayEnvPrefix);
  if (calId && row.meeting.googleEventId) {
    const ataText = `${noteTitle}\n${url}`;
    const r = await attachAtaToOccurrence(calId, row.meeting.googleEventId, row.occurredOn.toISOString(), ataText).catch((e) => ({ error: String(e) }));
    if ("ok" in r) {
      calendar = "link no Google Calendar";
      await prisma.meetingOccurrence.update({ where: { id: occurrenceId }, data: { googleEventId: r.instanceId } }).catch(() => {});
    } else {
      calendar = `Calendar: ${r.error}`;
    }
  }

  const updated = await prisma.meetingOccurrence.update({ where: { id: occurrenceId }, data: { hackmdUrl: url } });
  revalidatePath("/reunioes");
  return { ok: true, occurrence: toDTO(updated), url, calendar };
}

/**
 * Backfill occurrences from the two clouds: HackMD notes whose title matches this
 * meeting + a date, and (best-effort) the meeting's recent Calendar instances.
 * Creates any occurrence we don't have yet, linking its HackMD note.
 */
export async function reconcileOccurrences(
  meetingId: string,
): Promise<{ ok: true; added: number; linked: number } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const meeting = await ownedMeeting(meetingId, g.project.slug);
  if (!meeting) return { ok: false, error: "Reunião não encontrada." };

  const { hackmdConfigured, listHackmdNotes } = await import("@/lib/hackmd");
  if (!hackmdConfigured()) return { ok: false, error: "HACKMD_API_KEY não configurada." };
  const notes = await listHackmdNotes(100).catch(() => []);

  // Match notes titled like "…<meeting title>… YYYY-MM-DD".
  const titleNeedle = meeting.title.toLowerCase().replace(/\s+/g, " ").trim();
  let added = 0;
  let linked = 0;
  for (const note of notes) {
    const t = note.title.toLowerCase();
    const dateM = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!dateM) continue;
    // The note must reference this meeting (by a distinctive word from its title).
    const words = titleNeedle.split(/[\s—-]+/).filter((w) => w.length >= 4);
    if (words.length && !words.some((w) => t.includes(w))) continue;
    const occurredOn = new Date(`${dateM[1]}-${dateM[2]}-${dateM[3]}T14:00:00.000Z`);
    const existing = await prisma.meetingOccurrence.findUnique({
      where: { meetingId_occurredOn: { meetingId, occurredOn } },
    });
    if (existing) {
      if (!existing.hackmdUrl) {
        await prisma.meetingOccurrence.update({ where: { id: existing.id }, data: { hackmdUrl: note.url } });
        linked++;
      }
      continue;
    }
    await prisma.meetingOccurrence.create({
      data: { meetingId, projectSlug: g.project.slug, occurredOn, hackmdUrl: note.url, createdBy: "reconcile" },
    });
    added++;
  }
  revalidatePath("/reunioes");
  return { ok: true, added, linked };
}
