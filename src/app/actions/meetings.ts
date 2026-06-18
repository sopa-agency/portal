"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";
import { meetingsCalendarId, meetingsTimeZone, upsertCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar";
import { MEETING_AI_INSTRUCTION } from "@/lib/ai-prompts";

export type MeetingDTO = {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  notes: string | null;
  forProject: string | null;
  emailBody: string | null;
  kind: "plan" | "exec";
  owners: string[];
  color: string | null;
  weekly: boolean;
  attendees: string[];
  googleEventUrl: string | null;
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
  id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; forProject: string | null; emailBody: string | null; kind: string; owners: string[]; color: string | null; weekly: boolean; attendees: string[]; googleEventUrl: string | null;
}): MeetingDTO => ({
  id: m.id,
  title: m.title,
  startsAt: m.startsAt.toISOString(),
  endsAt: m.endsAt.toISOString(),
  notes: m.notes,
  forProject: m.forProject,
  emailBody: m.emailBody,
  kind: m.kind === "exec" ? "exec" : "plan",
  owners: m.owners,
  color: m.color,
  weekly: m.weekly,
  attendees: m.attendees,
  googleEventUrl: m.googleEventUrl,
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
  m: { id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; weekly: boolean; emailBody?: string | null },
  attendees: string[],
): Promise<{ sent: number; error?: string }> {
  if (attendees.length === 0) return { sent: 0 };
  const { sendProjectEmail } = await import("@/lib/email");
  const prefix = project.agent.gatewayEnvPrefix;
  const organizer = process.env[`${prefix}_EMAIL_FROM`] ?? process.env.EMAIL_FROM ?? `noreply@skatehive.app`;
  const ics = buildInviteIcs(m, organizer, attendees);
  const when = m.startsAt.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  // Use the AI-improved / edited email body when present; else the default.
  const intro = m.emailBody?.trim() || `Você foi convidado para "${m.title}" — ${when}.${m.notes ? `\n\n${m.notes}` : ""}`;
  const introHtml = `<p>${intro.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p><p style="color:#888">${when}${m.weekly ? " · toda semana" : ""}</p>`;
  let sent = 0;
  let error: string | undefined;
  for (const to of attendees) {
    const res = await sendProjectEmail(project, {
      to,
      subject: `Convite: ${m.title}`,
      text: `${intro}\n\n${when}${m.weekly ? " · toda semana" : ""}`,
      html: introHtml,
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
): Promise<{ eventId?: string; url?: string | null; error?: string }> {
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
    return "error" in res ? { error: res.error } : { eventId: res.eventId, url: res.url };
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
  forProject?: string;
  emailBody?: string;
  kind?: "plan" | "exec";
  owners?: string[];
  color?: string;
  weekly?: boolean;
  attendees?: string[];
}): Promise<{ ok: true; meeting: MeetingDTO; invited?: number; inviteError?: string; calendarError?: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!input.title.trim()) return { ok: false, error: "Título obrigatório." };
  const attendees = (input.attendees ?? []).map((a) => a.trim().toLowerCase()).filter((a) => /@/.test(a));
  const owners = (input.owners ?? []).map((a) => a.trim().toLowerCase()).filter((a) => /@/.test(a) && attendees.includes(a));
  let m = await prisma.meeting.create({
    data: {
      projectSlug: g.project.slug,
      title: input.title.trim().slice(0, 200),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      notes: input.notes?.trim() || null,
      forProject: input.forProject?.trim() || null,
      emailBody: input.emailBody?.trim() || null,
      kind: input.kind === "exec" ? "exec" : "plan",
      owners,
      color: input.color || null,
      weekly: !!input.weekly,
      attendees,
      createdBy: g.username,
    },
  });
  const inv = await sendInvites(g.project, m, attendees);
  const cal = await pushToCalendar(g.project, m);
  if (cal.eventId) m = await prisma.meeting.update({ where: { id: m.id }, data: { googleEventId: cal.eventId, googleEventUrl: cal.url ?? null } });
  return { ok: true, meeting: toDTO(m), invited: inv.sent, inviteError: inv.error, calendarError: cal.error };
}

export async function updateMeeting(
  id: string,
  patch: { title?: string; startsAt?: string; endsAt?: string; notes?: string | null; forProject?: string | null; emailBody?: string | null; kind?: "plan" | "exec"; owners?: string[]; color?: string | null; weekly?: boolean; attendees?: string[] },
  resendInvites?: boolean,
): Promise<{ ok: true; meeting: MeetingDTO; invited?: number; inviteError?: string; calendarError?: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };
  const attendees = patch.attendees?.map((a) => a.trim().toLowerCase()).filter((a) => /@/.test(a));
  // Owners must be among the attendees of this meeting.
  const finalAttendees = attendees ?? existing.attendees;
  const owners = patch.owners?.map((a) => a.trim().toLowerCase()).filter((a) => /@/.test(a) && finalAttendees.includes(a));
  let m = await prisma.meeting.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 200) } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: new Date(patch.startsAt) } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: new Date(patch.endsAt) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.forProject !== undefined ? { forProject: patch.forProject?.trim() || null } : {}),
      ...(patch.emailBody !== undefined ? { emailBody: patch.emailBody?.trim() || null } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind === "exec" ? "exec" : "plan" } : {}),
      ...(owners !== undefined ? { owners } : {}),
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

/** Improve the meeting agenda + draft the invite email with the project's AI agent. */
export async function improveMeeting(input: {
  title: string;
  notes?: string;
  kind?: "plan" | "exec";
  forProject?: string;
  when?: string;
  attendees?: string[];
  owners?: string[];
  /** Custom instruction from "Editar prompt" (defaults to MEETING_AI_INSTRUCTION). */
  instruction?: string;
}): Promise<{ ok: true; agenda: string; email: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!input.title.trim()) return { ok: false, error: "Dê um título antes de melhorar com IA." };

  const directive = input.instruction?.trim() || MEETING_AI_INSTRUCTION;
  const kindLabel =
    input.kind === "exec"
      ? "EXEC — reunião de execução, com donos responsáveis + espectadores"
      : "PLAN — reunião de planejamento (revisar o que foi feito, definir próximos passos)";
  const prompt = `Você ajuda a preparar reuniões de equipe. ${directive}

Reunião: "${input.title}"
Tipo: ${kindLabel}
${input.forProject ? `Projeto: ${input.forProject}\n` : ""}${input.when ? `Quando: ${input.when}\n` : ""}Pauta atual (rascunho): ${input.notes?.trim() || "(vazia)"}
Convidados: ${(input.attendees ?? []).join(", ") || "(nenhum)"}
${input.owners?.length ? `Responsáveis (donos): ${input.owners.join(", ")}\n` : ""}
Responda APENAS com JSON válido, sem texto fora dele:
{"agenda":"<pauta melhorada em tópicos curtos>","email":"<corpo de email de convite curto>"}`;

  let raw: string;
  try {
    const { callOpenClaw } = await import("@/lib/openclaw-gateway");
    raw = await callOpenClaw(prompt, g.project.agent.id, { project: g.project, timeoutMs: 90000 });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao chamar a IA." };
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { agenda?: string; email?: string };
      return { ok: true, agenda: (parsed.agenda ?? input.notes ?? "").trim(), email: (parsed.email ?? "").trim() };
    } catch {
      /* fall through */
    }
  }
  return { ok: true, agenda: raw.trim(), email: "" };
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
