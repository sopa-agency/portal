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

export type FreeBusyResult = {
  busy: Record<string, { start: string; end: string }[]>;
  errors: Record<string, string>;
};

/** Query free/busy for a set of calendar ids (emails shared with the SA). */
export async function queryFreeBusy(ids: string[], timeMin: Date, timeMax: Date): Promise<FreeBusyResult | { error: string }> {
  if (ids.length === 0) return { busy: {}, errors: {} };
  const acc = getAppServiceAccount();
  if (!acc) return { error: "Service account não configurado (GOOGLE_SERVICE_ACCOUNT_JSON)." };

  const { JWT } = await import("google-auth-library");
  const jwt = new JWT({
    email: acc.clientEmail,
    key: acc.sa.private_key as string,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const { access_token } = await jwt.authorize();
  if (!access_token) return { error: "Falha ao autenticar a service account." };

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
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
