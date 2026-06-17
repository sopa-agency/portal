"use server";

import ical from "node-ical";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects/index";

export type SharedCalendarDTO = { id: string; name: string; icsUrl: string; color: string | null };
export type BusyBlock = { calendarId: string; name: string; color: string | null; start: string; end: string };

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
  const url = input.icsUrl.trim().replace(/^webcal:/i, "https:");
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Link inválido — use a URL iCal/ICS (https)." };
  if (!input.name.trim()) return { ok: false, error: "Dê um nome (pessoa/calendário)." };
  const row = await prisma.sharedCalendar.create({
    data: { projectSlug: g.project.slug, name: input.name.trim().slice(0, 80), icsUrl: url, color: input.color || null, createdBy: g.username },
  });
  return { ok: true, calendar: { id: row.id, name: row.name, icsUrl: row.icsUrl, color: row.color } };
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
export async function getAvailability(
  weekStartIso: string,
): Promise<{ ok: true; busy: BusyBlock[]; errors: string[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const weekStart = new Date(weekStartIso);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const cals = await prisma.sharedCalendar.findMany({ where: { projectSlug: g.project.slug } });

  const busy: BusyBlock[] = [];
  const errors: string[] = [];
  await Promise.all(
    cals.map(async (cal) => {
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
  return { ok: true, busy, errors };
}
