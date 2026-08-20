import "server-only";
import fs from "node:fs";

// Single app-wide Google service account for Calendar (free/busy). Reads the
// global GOOGLE_SERVICE_ACCOUNT_JSON; falls back to the SkateHive SA so it works
// today without new env. People share their calendar (free/busy) with this SA's
// email; the Calendar API must be enabled on that SA's Google Cloud project.

function resolveServiceAccount(envValue: string): Record<string, unknown> {
  const trimmed = envValue.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Record<string, unknown>;
  return JSON.parse(fs.readFileSync(trimmed, "utf8")) as Record<string, unknown>;
}

function getAppServiceAccount(): { sa: Record<string, unknown>; clientEmail: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.SKATEHIVE_GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = resolveServiceAccount(raw);
    return { sa, clientEmail: sa.client_email as string };
  } catch {
    return null;
  }
}

/** The email teammates must share their calendar (free/busy) with. */
export function appCalendarEmail(): string | null {
  return getAppServiceAccount()?.clientEmail ?? null;
}

/**
 * Primary calendar that meetings are mirrored to. Per-project override
 * (`${PREFIX}_GOOGLE_MEETINGS_CALENDAR_ID`) falls back to a global one. This is
 * a calendar id / email (e.g. the SkateHive Google account) that must be shared
 * with the app service account with "Make changes to events" permission.
 */
export function meetingsCalendarId(prefix?: string): string | null {
  const scoped = prefix ? process.env[`${prefix}_GOOGLE_MEETINGS_CALENDAR_ID`] : undefined;
  return (scoped || process.env.GOOGLE_MEETINGS_CALENDAR_ID || "").trim() || null;
}

/** IANA timezone used for mirrored events (a recurring RRULE needs a stable one). */
export function meetingsTimeZone(prefix?: string): string {
  const scoped = prefix ? process.env[`${prefix}_GOOGLE_MEETINGS_TZ`] : undefined;
  return (scoped || process.env.GOOGLE_MEETINGS_TZ || "America/Sao_Paulo").trim();
}

async function getAccessToken(scopes: string[]): Promise<{ token: string } | { error: string }> {
  const acc = getAppServiceAccount();
  if (!acc) return { error: "Service account não configurado (GOOGLE_SERVICE_ACCOUNT_JSON)." };
  const { JWT } = await import("google-auth-library");
  const jwt = new JWT({ email: acc.clientEmail, key: acc.sa.private_key as string, scopes });
  const { access_token } = await jwt.authorize();
  if (!access_token) return { error: "Falha ao autenticar a service account." };
  return { token: access_token };
}

export type FreeBusyResult = {
  busy: Record<string, { start: string; end: string }[]>;
  errors: Record<string, string>;
};

/** Query free/busy for a set of calendar ids (emails shared with the SA). */
export async function queryFreeBusy(ids: string[], timeMin: Date, timeMax: Date): Promise<FreeBusyResult | { error: string }> {
  if (ids.length === 0) return { busy: {}, errors: {} };
  const tok = await getAccessToken(["https://www.googleapis.com/auth/calendar.readonly"]);
  if ("error" in tok) return { error: tok.error };

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: ids.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `freeBusy HTTP ${res.status}${/calendar.*not.*enabled|accessNotConfigured/i.test(body) ? " — habilite a Google Calendar API no projeto" : ""}` };
  }
  const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> };
  const busy: Record<string, { start: string; end: string }[]> = {};
  const errors: Record<string, string> = {};
  for (const [id, cal] of Object.entries(data.calendars ?? {})) {
    if (cal.errors?.length) errors[id] = cal.errors.map((e) => e.reason).join(", ");
    busy[id] = cal.busy ?? [];
  }
  return { busy, errors };
}

export type TitledEvent = { start: string; end: string; summary?: string };

/**
 * List timed events (with titles) for a calendar in a window. Works only when
 * the SA has "see all event details" access; free/busy-only sharing returns 403
 * (caller falls back to queryFreeBusy). All-day events are skipped.
 */
export async function queryCalendarEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<{ events: TitledEvent[] } | { error: string }> {
  const tok = await getAccessToken(["https://www.googleapis.com/auth/calendar.readonly"]);
  if ("error" in tok) return { error: tok.error };
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}` }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) return { error: `events HTTP ${res.status}` };
  const data = (await res.json()) as { items?: { start?: { dateTime?: string }; end?: { dateTime?: string }; summary?: string }[] };
  const events: TitledEvent[] = (data.items ?? [])
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({ start: e.start!.dateTime!, end: e.end!.dateTime!, summary: e.summary }));
  return { events };
}

export type CalendarEventInput = {
  summary: string;
  description?: string | null;
  startISO: string;
  endISO: string;
  weekly: boolean;
  timeZone: string;
};

function eventBody(ev: CalendarEventInput): Record<string, unknown> {
  // NOTE: no `attendees` — a service account cannot invite attendees without
  // domain-wide delegation (Google rejects the insert). Invites are sent
  // separately as ICS emails; this just mirrors the event onto the calendar.
  return {
    summary: ev.summary,
    ...(ev.description ? { description: ev.description } : {}),
    start: { dateTime: ev.startISO, timeZone: ev.timeZone },
    end: { dateTime: ev.endISO, timeZone: ev.timeZone },
    ...(ev.weekly ? { recurrence: ["RRULE:FREQ=WEEKLY"] } : {}),
  };
}

/** Insert (eventId null) or update an event on the given calendar. */
export async function upsertCalendarEvent(
  calendarId: string,
  eventId: string | null,
  ev: CalendarEventInput,
): Promise<{ ok: true; eventId: string; url: string | null } | { error: string }> {
  const tok = await getAccessToken(["https://www.googleapis.com/auth/calendar.events"]);
  if ("error" in tok) return { error: tok.error };
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  const res = await fetch(url, {
    method: eventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(ev)),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A stale event id (deleted on Google) → retry as a fresh insert.
    if (eventId && res.status === 404) return upsertCalendarEvent(calendarId, null, ev);
    const hint = /notFound|forbidden|insufficient|writer access|accessNotConfigured|not.*enabled/i.test(body)
      ? " — confira se o calendário foi compartilhado com a service account com permissão de editar eventos, e se a Calendar API está habilitada"
      : "";
    return { error: `Calendar HTTP ${res.status}${hint}` };
  }
  const data = (await res.json()) as { id?: string; htmlLink?: string };
  return data.id ? { ok: true, eventId: data.id, url: data.htmlLink ?? null } : { error: "Calendar: resposta sem id de evento." };
}

// Portal-managed block inside an event's description. We own only this block —
// anything the user typed around it is preserved across updates.
const ATA_MARK = "— Ata (portal) —";

function mergeAtaBlock(existing: string | undefined, ataText: string): string {
  const base = (existing ?? "").split(ATA_MARK)[0].trimEnd();
  return `${base}${base ? "\n\n" : ""}${ATA_MARK}\n${ataText}`.trim();
}

/**
 * Write the ata link/TL;DR into the description of the SPECIFIC occurrence of a
 * (possibly recurring) event. For a weekly series we resolve the instance on
 * `occurredOnISO` and patch just that instance (creating an exception); for a
 * one-off event we patch it directly. Returns the patched event/instance id so
 * the caller can store it on the occurrence. Best-effort — never throws.
 */
export async function attachAtaToOccurrence(
  calendarId: string,
  eventId: string,
  occurredOnISO: string,
  ataText: string,
): Promise<{ ok: true; instanceId: string } | { error: string }> {
  const tok = await getAccessToken(["https://www.googleapis.com/auth/calendar.events"]);
  if ("error" in tok) return { error: tok.error };
  const auth = { Authorization: `Bearer ${tok.token}` };
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  // Resolve the instance covering that day (works only for recurring events).
  const day = new Date(occurredOnISO);
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 36 * 3600_000);
  let targetId = eventId;
  let existingDesc: string | undefined;
  try {
    const iu = new URL(`${base}/${encodeURIComponent(eventId)}/instances`);
    iu.searchParams.set("timeMin", dayStart.toISOString());
    iu.searchParams.set("timeMax", dayEnd.toISOString());
    iu.searchParams.set("maxResults", "5");
    const ir = await fetch(iu, { headers: auth, signal: AbortSignal.timeout(9000) });
    if (ir.ok) {
      const d = (await ir.json()) as { items?: { id: string; description?: string; start?: { dateTime?: string } }[] };
      const inst = d.items?.[0];
      if (inst?.id) { targetId = inst.id; existingDesc = inst.description; }
    }
  } catch { /* not recurring / no access — fall through to base event */ }

  // If we didn't get an instance description, read the base event's.
  if (existingDesc === undefined) {
    try {
      const er = await fetch(`${base}/${encodeURIComponent(targetId)}`, { headers: auth, signal: AbortSignal.timeout(9000) });
      if (er.ok) existingDesc = ((await er.json()) as { description?: string }).description;
    } catch { /* ignore */ }
  }

  const res = await fetch(`${base}/${encodeURIComponent(targetId)}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ description: mergeAtaBlock(existingDesc, ataText) }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = /notFound|forbidden|insufficient|writer access|accessNotConfigured|not.*enabled/i.test(body)
      ? " — confira o compartilhamento do calendário com a service account (editar eventos)"
      : "";
    return { error: `Calendar HTTP ${res.status}${hint}` };
  }
  const data = (await res.json()) as { id?: string };
  return { ok: true, instanceId: data.id ?? targetId };
}

export async function deleteCalendarEvent(calendarId: string, eventId: string): Promise<{ ok: boolean; error?: string }> {
  const tok = await getAccessToken(["https://www.googleapis.com/auth/calendar.events"]);
  if ("error" in tok) return { ok: false, error: tok.error };
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${tok.token}` }, signal: AbortSignal.timeout(9000) },
  );
  // 410 = already gone; treat as success.
  if (res.ok || res.status === 410 || res.status === 404) return { ok: true };
  return { ok: false, error: `Calendar HTTP ${res.status}` };
}
