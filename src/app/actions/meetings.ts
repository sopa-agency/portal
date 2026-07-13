"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";
import { meetingsCalendarId, meetingsTimeZone, upsertCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar";
import { MEETING_AI_INSTRUCTION } from "@/lib/ai-prompts";
import type { MeetingActionItem } from "@/lib/meeting-actions";
import { parseActionItems } from "@/lib/meeting-actions";

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
  transcript: string | null;
  summary: string | null;
  summaryUrl: string | null;
  actionItems: MeetingActionItem[];
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
  id: string; title: string; startsAt: Date; endsAt: Date; notes: string | null; forProject: string | null; emailBody: string | null; kind: string; owners: string[]; color: string | null; weekly: boolean; attendees: string[]; googleEventUrl: string | null; transcript?: string | null; summary?: string | null; summaryUrl?: string | null; actionItems?: unknown;
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
  transcript: m.transcript ?? null,
  summary: m.summary ?? null,
  summaryUrl: m.summaryUrl ?? null,
  actionItems: parseActionItems(m.actionItems),
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

// ---------------------------------------------------------------------------
// Post-meeting layer: summary (ata) + action items + Kanban cards
// ---------------------------------------------------------------------------

/** Persist edits to the transcript / summary / action items of a meeting. */
export async function saveMeetingSummary(
  id: string,
  patch: { transcript?: string | null; summary?: string | null; summaryUrl?: string | null; actionItems?: MeetingActionItem[] },
): Promise<{ ok: true; meeting: MeetingDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };
  const m = await prisma.meeting.update({
    where: { id },
    data: {
      ...(patch.transcript !== undefined ? { transcript: patch.transcript?.trim() || null } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary?.trim() || null } : {}),
      ...(patch.summaryUrl !== undefined ? { summaryUrl: patch.summaryUrl?.trim() || null } : {}),
      ...(patch.actionItems !== undefined
        ? { actionItems: parseActionItems(patch.actionItems) as unknown as object[] }
        : {}),
    },
  });
  return { ok: true, meeting: toDTO(m) };
}

/**
 * Extract a summary (ata) + structured action items from a transcript/notes
 * using the project agent. Mirrors improveMeeting's callOpenClaw + parse-JSON
 * pattern. Owners are constrained to real team usernames and projects to real
 * slugs so the result can drive Kanban card creation directly.
 */
export async function extractMeetingActions(
  id: string,
  opts: { source?: string; instruction?: string } = {},
): Promise<{ ok: true; meeting: MeetingDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };

  const source = (opts.source?.trim() || existing.transcript?.trim() || existing.notes?.trim() || "");
  if (!source) return { ok: false, error: "Cole a transcrição ou a ata antes de extrair as ações." };

  const { getAllProjects } = await import("@/projects/index");
  const { getTeamRoster } = await import("@/lib/team-roster");
  const projects = getAllProjects();
  const roster = await getTeamRoster(g.project).catch(() => []);
  const slugList = projects.map((p) => `${p.slug} (${p.name})`).join(", ");
  const userList = roster.map((r) => r.username).join(", ");
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Você é o secretário da agência SOPA. A partir do texto de uma reunião (transcrição automática — pode ter erros de grafia em nomes/termos), produza (1) uma ATA em markdown e (2) a lista de AÇÕES estruturadas.

${opts.instruction?.trim() ? `Instrução extra: ${opts.instruction.trim()}\n` : ""}Data de hoje: ${today}
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
    raw = await callOpenClaw(prompt, g.project.agent.id, { project: g.project, timeoutMs: 180000 });
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

  // Constrain to real slugs / usernames; drop hallucinated owners/projects.
  const validSlugs = new Set(projects.map((p) => p.slug));
  const validUsers = new Set(roster.map((r) => r.username.toLowerCase()));
  const cleaned = parseActionItems(parsed.actionItems).map((it) => ({
    ...it,
    project: validSlugs.has(it.project) ? it.project : "",
    owner: it.owner && validUsers.has(it.owner) ? it.owner : null,
  }));

  const { sanitizeForDb } = await import("@/lib/sanitize");
  const m = await prisma.meeting.update({
    where: { id },
    data: {
      transcript: opts.source ? sanitizeForDb(source).slice(0, 200000) : existing.transcript,
      summary: parsed.summary ? sanitizeForDb(parsed.summary).slice(0, 100000) : existing.summary,
      actionItems: cleaned as unknown as object[],
    },
  });
  return { ok: true, meeting: toDTO(m) };
}

/**
 * Turn a meeting's action items into GitHub Project cards on each item's target
 * board. Idempotent: items that already have a cardItemId are skipped. Owner →
 * GitHub login (portal-owned CardPriority.owner + a real GH assignee when the
 * login resolves), plus fire-priority + deadline. Cards land as draft issues so
 * no repo choice is needed and priority/owner overlays work immediately.
 */
export async function createCardsFromMeeting(
  id: string,
  itemIds?: string[],
): Promise<
  | { ok: true; created: number; results: { text: string; project: string; ok: boolean; error?: string }[] }
  | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };

  const items = parseActionItems(meeting.actionItems);
  const only = itemIds && itemIds.length ? new Set(itemIds) : null;
  const pending = items.filter(
    (it) => !it.cardItemId && it.project && (!only || only.has(it.id)),
  );
  if (!pending.length) return { ok: true, created: 0, results: [] };

  const {
    fetchGitHubProject,
    resolveGitHubToken,
    addDraftIssue,
    setItemStatus,
    setDraftAssignees,
    resolveUserIds,
  } = await import("@/lib/github-project");
  const { getAllProjects } = await import("@/projects/index");
  const { verifySession } = await import("@/lib/team-access");
  const { githubLoginsByUsername } = await import("@/lib/meeting-actions");

  const loginByUser = await githubLoginsByUsername();
  const projects = getAllProjects();
  const when = meeting.startsAt.toLocaleDateString("pt-BR");

  // Group by target project so each board is fetched once.
  const bySlug = new Map<string, MeetingActionItem[]>();
  for (const it of pending) {
    if (!bySlug.has(it.project)) bySlug.set(it.project, []);
    bySlug.get(it.project)!.push(it);
  }

  const results: { text: string; project: string; ok: boolean; error?: string }[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));

  for (const [slug, group] of bySlug) {
    const target = projects.find((p) => p.slug === slug);
    const fail = (error: string) => group.forEach((it) => results.push({ text: it.text, project: slug, ok: false, error }));
    if (!target || !target.githubProject) { fail("sem board configurado"); continue; }
    const allowed = await verifySession(token, target);
    if (!allowed) { fail("sem acesso a este portal"); continue; }
    const ghToken = resolveGitHubToken(target);
    if (!ghToken) { fail("GITHUB_TOKEN ausente"); continue; }
    const board = await fetchGitHubProject(target);
    if (!board.ok) { fail(board.error); continue; }

    // Pick a sensible starting column (Todo/Backlog/Ready/Triage) if the board has one.
    const startCol = board.columns.find((c) => c.optionId && /todo|to do|backlog|triage|ready|próxim|proxim|icebox/i.test(c.name));

    for (const it of group) {
      const owner = it.owner ?? undefined;
      const login = owner ? loginByUser.get(owner) : undefined;
      const bodyLines = [
        `_Da reunião SOPA "${meeting.title}" (${when})._`,
        owner ? `\n**Dono:** @${owner}${login ? ` (github: @${login})` : ""}` : "",
      ].filter(Boolean);
      const draft = await addDraftIssue({
        token: ghToken,
        projectId: board.projectId,
        title: it.text.slice(0, 250),
        body: bodyLines.join("\n"),
      });
      if (!draft.ok) { results.push({ text: it.text, project: slug, ok: false, error: draft.error }); continue; }

      // Portal-owned overlays (priority / deadline / owner) keyed by the new item id.
      if (it.priority || it.deadline || login) {
        await prisma.cardPriority
          .upsert({
            where: { itemId: draft.itemId },
            create: {
              itemId: draft.itemId,
              priority: it.priority || 0,
              deadline: it.deadline ? new Date(it.deadline) : null,
              owner: login ?? null,
              projectSlug: slug,
              updatedBy: g.username,
            },
            update: {
              priority: it.priority || 0,
              deadline: it.deadline ? new Date(it.deadline) : null,
              owner: login ?? null,
              updatedBy: g.username,
            },
          })
          .catch(() => {});
      }

      // Real GitHub assignee when the login resolves to a user on this board.
      if (login && draft.contentId) {
        const ids = await resolveUserIds(ghToken, [login]).catch(() => ({}) as Record<string, string>);
        const uid = ids[login.toLowerCase()];
        if (uid) await setDraftAssignees({ token: ghToken, draftId: draft.contentId, assigneeIds: [uid] }).catch(() => {});
      }

      // Drop it into the starting column, best-effort.
      if (startCol?.optionId && board.statusFieldId) {
        await setItemStatus({
          token: ghToken,
          projectId: board.projectId,
          itemId: draft.itemId,
          fieldId: board.statusFieldId,
          optionId: startCol.optionId,
        }).catch(() => {});
      }

      const stored = byId.get(it.id);
      if (stored) stored.cardItemId = draft.itemId;
      results.push({ text: it.text, project: slug, ok: true });
    }
  }

  // Persist the cardItemId back so re-running never duplicates.
  await prisma.meeting.update({
    where: { id },
    data: { actionItems: items as unknown as object[] },
  });

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/reunioes");
  revalidatePath("/kanban");
  return { ok: true, created: results.filter((r) => r.ok).length, results };
}

/** Render the meeting's ata + action items as HackMD-ready markdown. */
function buildAtaMarkdown(m: {
  title: string; startsAt: Date; summary: string | null; notes: string | null; actionItems: MeetingActionItem[];
}): string {
  const when = m.startsAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
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
        const meta = [
          it.owner ? `@${it.owner}` : "",
          it.priority ? "🔥".repeat(it.priority) : "",
          it.deadline ? `⏰${it.deadline}` : "",
        ].filter(Boolean).join(" ");
        parts.push(`- [${it.done ? "x" : " "}] ${it.text}${meta ? ` — ${meta}` : ""}`);
      }
      parts.push("");
    }
  }
  return parts.join("\n");
}

/** Publish (or update) the meeting ata to HackMD; stores the note URL on the meeting. */
export async function publishMeetingToHackmd(
  id: string,
): Promise<{ ok: true; meeting: MeetingDTO; url: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.projectSlug !== g.project.slug) return { ok: false, error: "Reunião não encontrada." };

  const { hackmdConfigured, createHackmdNote, updateHackmdNote, noteIdFromUrl } = await import("@/lib/hackmd");
  if (!hackmdConfigured()) return { ok: false, error: "HACKMD_API_KEY não configurada no portal." };

  const content = buildAtaMarkdown({
    title: meeting.title,
    startsAt: meeting.startsAt,
    summary: meeting.summary,
    notes: meeting.notes,
    actionItems: parseActionItems(meeting.actionItems),
  });
  const noteTitle = `🍲 ${meeting.title} — ${meeting.startsAt.toLocaleDateString("pt-BR")}`;

  try {
    const existingId = noteIdFromUrl(meeting.summaryUrl);
    let url = meeting.summaryUrl ?? "";
    if (existingId) {
      await updateHackmdNote(existingId, content);
      url = `https://hackmd.io/${existingId}`;
    } else {
      const note = await createHackmdNote({ title: noteTitle, content });
      url = note.url;
    }
    const m = await prisma.meeting.update({ where: { id }, data: { summaryUrl: url } });
    return { ok: true, meeting: toDTO(m), url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao publicar no HackMD." };
  }
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
