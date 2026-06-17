"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";
import { meetingsCalendarId, meetingsTimeZone, upsertCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar";

export type MeetingDTO = {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  notes: string | null;
  color: string | null;
  weekly: boolean;
  attendees: string[];
};

async function gate() {
  const project = await getActiveProject();
  if (!project.meetings) return { ok: false as const, error: "Reuniões não habilitadas." };
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, username: session.username };
}

const toDTO = (m: {
  id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; color: string | null; weekly: boolean; attendees: string[];
}): MeetingDTO => ({
  id: m.id,
  title: m.title,
  startsAt: m.startsAt.toISOString(),
  endsAt: m.endsAt.toISOString(),
  notes: m.notes,
  color: m.color,
  weekly: m.weekly,
  attendees: m.attendees,
});

// --- calendar invite (ICS) ---
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function buildInviteIcs(m: { id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; weekly: boolean }, organizer: string, attendees: string[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//portal-skatehive//reunioes//PT",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${m.id}@portal-skatehive`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.startsAt)}`,
    `DTEND:${icsDate(m.endsAt)}`,
    `SUMMARY:${icsEscape(m.title)}`,
    ...(m.notes ? [`DESCRIPTION:${icsEscape(m.notes)}`] : []),
    ...(m.weekly ? ["RRULE:FREQ=WEEKLY"] : []),
    `ORGANIZER:mailto:${organizer}`,
    ...attendees.map((a) => `ATTENDEE;RSVP=TRUE:mailto:${a}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

async function sendInvites(
  project: ProjectConfig,
  m: { id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; weekly: boolean },
  attendees: string[],
): Promise<{ sent: number; error?: string }> {
  if (attendees.length === 0) return { sent: 0 };
  const { sendProjectEmail } = await import("@/lib/email");
  const prefix = project.agent.gatewayEnvPrefix;
  const organizer = process.env[`${prefix}_EMAIL_FROM`] ?? process.env.EMAIL_FROM ?? `noreply@skatehive.app`;
  const ics = buildInviteIcs(m, organizer, attendees);
  const when = m.startsAt.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  let sent = 0;
  let error: string | undefined;
  for (const to of attendees) {
    const res = await sendProjectEmail(project, {
      to,
      subject: `Convite: ${m.title}`,
      text: `Você foi convidado para "${m.title}" — ${when}.${m.notes ? `\n\n${m.notes}` : ""}`,
      html: `<p>Você foi convidado para <strong>${m.title}</strong>.</p><p>${when}${m.weekly ? " · toda semana" : ""}</p>${m.notes ? `<p>${m.notes}</p>` : ""}`,
      icalEvent: { method: "REQUEST", content: ics },
    });
    if (res.ok) sent++;
    else error = res.error;
  }
  return { sent, error };
}

// Mirror the meeting onto the primary Google Calendar (if configured). Returns
// the (new or existing) Google event id, or an error string — never throws so a
// calendar hiccup can't block saving the meeting.
async function pushToCalendar(
  project: ProjectConfig,
  m: { id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; weekly: boolean; googleEventId: string | null },
): Promise<{ eventId?: string; error?: string }> {
  const calId = meetingsCalendarId(project.agent.gatewayEnvPrefix);
  if (!calId) return {}; // feature off until a calendar is configured
  try {
    const res = await upsertCalendarEvent(calId, m.googleEventId, {
      summary: m.title,
      description: m.notes,
      startISO: m.startsAt.toISOString(),
      endISO: m.endsAt.toISOString(),
      weekly: m.weekly,
      timeZone: meetingsTimeZone(project.agent.gatewayEnvPrefix),
    });
    return "error" in res ? { error: res.error } : { eventId: res.eventId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listMeetings(): Promise<{ ok: true; meetings: MeetingDTO[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const rows = await prisma.meeting.findMany({
    where: { projectSlug: g.project.slug },
    orderBy: { startsAt: "asc" },
  });
  return { ok: true, meetings: rows.map(toDTO) };
}

export async function createMeeting(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  color?: string;
  weekly?: boolean;
  attendees?: string[];
}): Promise<{ ok: true; meeting: MeetingDTO; invited?: number; inviteError?: string; calendarError?: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!input.title.trim()) return { ok: false, error: "Título obrigatório." };
  const attendees = (input.attendees ?? []).map((a) => a.trim().toLowerCase()).filter((a) => /@/.test(a));
  let m = await prisma.meeting.create({
    data: {
      projectSlug: g.project.slug,
      title: input.title.trim().slice(0, 200),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      notes: input.notes?.trim() || null,
      color: input.color || null,
      weekly: !!input.weekly,
      attendees,
      createdBy: g.username,
    },
  });
  const inv = await sendInvites(g.project, m, attendees);
  const cal = await pushToCalendar(g.project, m);
  if (cal.eventId) m = await prisma.meeting.update({ where: { id: m.id }, data: { googleEventId: cal.eventId } });
  return { ok: true, meeting: toDTO(m), invited: inv.sent, inviteError: inv.error, calendarError: cal.error };
}

export async function updateMeeting(
  id: string,
  patch: { title?: string; startsAt?: string; endsAt?: string; notes?: string | null; color?: string | null; weekly?: boolean; attendees?: string[] },
  resendInvites?: boolean,
): Promise<{ ok: true; meeting: MeetingDTO; invited?: number; inviteError?: string; calendarError?: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };
  const attendees = patch.attendees?.map((a) => a.trim().toLowerCase()).filter((a) => /@/.test(a));
  let m = await prisma.meeting.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 200) } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: new Date(patch.startsAt) } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: new Date(patch.endsAt) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.color !== undefined ? { color: patch.color || null } : {}),
      ...(patch.weekly !== undefined ? { weekly: patch.weekly } : {}),
      ...(attendees !== undefined ? { attendees } : {}),
    },
  });
  const cal = await pushToCalendar(g.project, m);
  if (cal.eventId && cal.eventId !== m.googleEventId) m = await prisma.meeting.update({ where: { id: m.id }, data: { googleEventId: cal.eventId } });
  if (resendInvites && m.attendees.length) {
    const inv = await sendInvites(g.project, m, m.attendees);
    return { ok: true, meeting: toDTO(m), invited: inv.sent, inviteError: inv.error, calendarError: cal.error };
  }
  return { ok: true, meeting: toDTO(m), calendarError: cal.error };
}

export async function deleteMeeting(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };
  const calId = meetingsCalendarId(g.project.agent.gatewayEnvPrefix);
  if (existing.googleEventId && calId) await deleteCalendarEvent(calId, existing.googleEventId).catch(() => {});
  await prisma.meeting.delete({ where: { id } });
  return { ok: true };
}
