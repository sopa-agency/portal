"use server";

import ical from "node-ical";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { queryFreeBusy, queryCalendarEvents, appCalendarEmail, meetingsCalendarId } from "@/lib/google-calendar";
import { getTeamEmails } from "@/lib/team-roster";

const isUrl = (s: string) => /^https?:\/\//i.test(s);
// Stable per-member colors for the availability overlay (assigned by roster order).
const TEAM_COLORS = ["#a3e635", "#38bdf8", "#f472b6", "#fbbf24", "#c084fc", "#34d399", "#fb923c", "#22d3ee"];

export type SharedCalendarDTO = { id: string; name: string; icsUrl: string; color: string | null };
// `title` = event summary when the calendar grants detail access; else undefined (just "busy").
export type BusyBlock = { calendarId: string; name: string; color: string | null; start: string; end: string; title?: string };
// Per-team-member availability status, so the panel can show who's connected.
export type TeamAvail = { username: string; email: string; status: "ok" | "notShared" | "error"; detail?: string; color: string };

async function gate() {
  const project = await getActiveProject();
  if (!project.meetings) return { ok: false as const, error: "Reuniões não habilitadas." };
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, username: session.username };
}

export async function listSharedCalendars(): Promise<
  { ok: true; calendars: SharedCalendarDTO[] } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const rows = await prisma.sharedCalendar.findMany({ where: { projectSlug: g.project.slug }, orderBy: { name: "asc" } });
  return { ok: true, calendars: rows.map((r) => ({ id: r.id, name: r.name, icsUrl: r.icsUrl, color: r.color })) };
}

export async function addSharedCalendar(input: { name: string; icsUrl: string; color?: string }): Promise<
  { ok: true; calendar: SharedCalendarDTO } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  // Accept either an iCal/ICS URL or a Google Calendar id (an email shared with
  // the app service account → real-time free/busy).
  const val = input.icsUrl.trim().replace(/^webcal:/i, "https:");
  const looksGoogleId = /@/.test(val) || /calendar\.google\.com/i.test(val);
  if (!isUrl(val) && !looksGoogleId) return { ok: false, error: "Use o link iCal (https) ou o email do Google Calendar." };
  if (!input.name.trim()) return { ok: false, error: "Dê um nome (pessoa/calendário)." };
  const row = await prisma.sharedCalendar.create({
    data: { projectSlug: g.project.slug, name: input.name.trim().slice(0, 80), icsUrl: val, color: input.color || null, createdBy: g.username },
  });
  return { ok: true, calendar: { id: row.id, name: row.name, icsUrl: row.icsUrl, color: row.color } };
}

/** The SA email teammates share with + the primary calendar meetings are written to. */
export async function getCalendarConnectInfo(): Promise<
  { ok: true; serviceEmail: string | null; meetingsCalendar: string | null } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  return { ok: true, serviceEmail: appCalendarEmail(), meetingsCalendar: meetingsCalendarId(g.project.agent.gatewayEnvPrefix) };
}

export async function deleteSharedCalendar(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.sharedCalendar.findUnique({ where: { id } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Não encontrado." };
  await prisma.sharedCalendar.delete({ where: { id } });
  return { ok: true };
}

// Busy blocks (no event titles — availability only) for the visible week.
// Loads the team roster automatically (free/busy of each member's email) plus
// any manually-added shared calendars.
export async function getAvailability(
  weekStartIso: string,
): Promise<{ ok: true; busy: BusyBlock[]; errors: string[]; team: TeamAvail[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const weekStart = new Date(weekStartIso);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const cals = await prisma.sharedCalendar.findMany({ where: { projectSlug: g.project.slug } });

  const busy: BusyBlock[] = [];
  const errors: string[] = [];

  // Team roster emails (auto) get a stable color by roster order.
  const roster = await getTeamEmails(g.project);
  const colorOf = new Map<string, string>();
  roster.forEach((r, i) => colorOf.set(r.email, TEAM_COLORS[i % TEAM_COLORS.length]));
  const team: TeamAvail[] = [];

  // Google-calendar ids (shared with the app SA) → one real-time free/busy call:
  // team member emails + manually-added Google calendars.
  const googleCals = cals.filter((c) => !isUrl(c.icsUrl));
  const googleIds = [...new Set([...roster.map((r) => r.email), ...googleCals.map((c) => c.icsUrl)])];
  if (googleIds.length) {
    const fb = await queryFreeBusy(googleIds, weekStart, weekEnd);
    if ("error" in fb) {
      errors.push(fb.error);
      for (const r of roster) team.push({ username: r.username, email: r.email, status: "error", detail: fb.error, color: colorOf.get(r.email)! });
    } else {
      // Best-effort titled events per calendar (only where the SA has "see all
      // event details" access — e.g. vlad / the SkateHive calendar). Free/busy-only
      // calendars 403 here and fall back to opaque "busy" blocks.
      const evEntries = await Promise.all(
        googleIds.map(async (id) => [id, await queryCalendarEvents(id, weekStart, weekEnd)] as const),
      );
      const titledById = new Map<string, { start: string; end: string; summary?: string }[]>();
      for (const [id, res] of evEntries) {
        if (!("error" in res) && res.events.some((e) => e.summary)) titledById.set(id, res.events);
      }
      const pushBlocks = (id: string, calendarId: string, name: string, color: string | null) => {
        const titled = titledById.get(id);
        if (titled) {
          for (const e of titled) busy.push({ calendarId, name, color, start: e.start, end: e.end, title: e.summary });
        } else {
          for (const b of fb.busy[id] ?? []) busy.push({ calendarId, name, color, start: b.start, end: b.end });
        }
      };
      for (const r of roster) {
        const reason = fb.errors[r.email];
        pushBlocks(r.email, `team:${r.username}`, r.username, colorOf.get(r.email)!);
        team.push({
          username: r.username,
          email: r.email,
          status: reason ? (/notFound|not found/i.test(reason) ? "notShared" : "error") : "ok",
          detail: reason,
          color: colorOf.get(r.email)!,
        });
      }
      for (const cal of googleCals) {
        pushBlocks(cal.icsUrl, cal.id, cal.name, cal.color);
        if (fb.errors[cal.icsUrl]) errors.push(`${cal.name}: ${fb.errors[cal.icsUrl]}`);
      }
    }
  }

  // iCal/ICS feeds (the rest).
  const icsCals = cals.filter((c) => isUrl(c.icsUrl));
  await Promise.all(
    icsCals.map(async (cal) => {
      try {
        const res = await fetch(cal.icsUrl, { signal: AbortSignal.timeout(8000), cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = ical.parseICS(await res.text());
        for (const k of Object.keys(data)) {
          // node-ical's union types don't narrow cleanly; use a minimal shape.
          const ev = data[k] as unknown as {
            type?: string;
            start?: Date;
            end?: Date;
            rrule?: { between(a: Date, b: Date, inc: boolean): Date[] };
            exdate?: Record<string, Date>;
          } | undefined;
          if (!ev || ev.type !== "VEVENT" || !ev.start || !ev.end) continue;
          const dur = ev.end.getTime() - ev.start.getTime() || 30 * 60000;
          const push = (s: Date) => {
            const e = new Date(s.getTime() + dur);
            if (e > weekStart && s < weekEnd) busy.push({ calendarId: cal.id, name: cal.name, color: cal.color, start: s.toISOString(), end: e.toISOString() });
          };
          if (ev.rrule) {
            const ex = new Set(Object.values(ev.exdate ?? {}).map((d) => d.getTime()));
            for (const occ of ev.rrule.between(weekStart, weekEnd, true)) {
              if (!ex.has(occ.getTime())) push(occ);
            }
          } else {
            push(ev.start);
          }
        }
      } catch (err) {
        errors.push(`${cal.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  return { ok: true, busy, errors, team };
}
