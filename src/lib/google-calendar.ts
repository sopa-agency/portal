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
): Promise<{ ok: true; eventId: string } | { error: string }> {
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
  const data = (await res.json()) as { id?: string };
  return data.id ? { ok: true, eventId: data.id } : { error: "Calendar: resposta sem id de evento." };
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
