"use client";

// Reusable month-grid schedule calendar fed by unified CalendarExtra events
// (Instagram posts, suggestion/repo scheduled tweets, Lab posts) — always for
// ONE project, the portal you are in. Used on the Post Suggestions page; the
// Post Creator keeps its richer thumbnail calendar.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarExtra } from "@/app/actions/post-creator";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { ScheduledPostDialog } from "@/components/scheduled-post-dialog";
import { ownEvents } from "@/lib/calendar-scope";

const CHIP_LIMIT = 3;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ScheduleCalendar({
  events,
  activeSlug,
  canCreate = false,
}: {
  events: CalendarExtra[];
  activeSlug: string;
  /** Show a hover "+" per day that opens the Post Creator pre-scheduled to it. */
  canCreate?: boolean;
}) {
  const [list, setList] = useState<CalendarExtra[]>(events);
  const [openEvent, setOpenEvent] = useState<CalendarExtra | null>(null);
  const [month, setMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const todayKey = dayKey(new Date());

  // This portal's events only — see calendar-scope. The server already scopes
  // the feed; this is the guard that keeps a widened query off the screen.
  const visible = useMemo(() => ownEvents(list, activeSlug), [list, activeSlug]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarExtra[]> = {};
    for (const e of visible) {
      const dt = new Date(e.when);
      if (Number.isNaN(dt.getTime())) continue;
      (map[dayKey(dt)] ??= []).push(e);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.when < b.when ? -1 : 1));
    return map;
  }, [visible]);

  const year = month.getFullYear();
  const m = month.getMonth();
  const gridDays = useMemo(() => {
    const startOffset = new Date(year, m, 1).getDay();
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(year, m, 1 - startOffset + i);
      return { date: d, inMonth: d.getMonth() === m };
    });
  }, [year, m]);

  const monthLabel = month.toLocaleString(undefined, { month: "long", year: "numeric" });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const hrefFor = (e: CalendarExtra): string | null => {
    if (e.kind === "instagram" && e.projectSlug === activeSlug) return "/post-creator";
    return null; // suggestion/repo open the edit dialog instead
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
          className="rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[160px] text-center text-sm font-semibold tabular-nums text-foreground">
          {monthLabel}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
          className="rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="ml-2 text-[11px] text-foreground-faint">
          this project&apos;s scheduled posts — Instagram, suggestions and repo runs
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {wd}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map(({ date, inMonth }, idx) => {
            const key = dayKey(date);
            const dayEvents = byDay[key] ?? [];
            const isToday = key === todayKey;
            const canAdd = canCreate && inMonth && key >= todayKey;
            return (
              <div
                key={key}
                className={`group relative min-h-[76px] border-border p-1.5 ${idx % 7 !== 6 ? "border-r" : ""} ${idx < 35 ? "border-b" : ""} ${!inMonth ? "bg-surface-elevated/40" : ""}`}
              >
                {canAdd && (
                  <a
                    href={`/post-creator?date=${key}`}
                    title="Criar post nesta data"
                    aria-label={`Criar post em ${key}`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:border-accent-border hover:text-accent"
                  >
                    <Plus className="h-3 w-3" />
                  </a>
                )}
                <div className="mb-1 flex items-center justify-center">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium tabular-nums ${
                      isToday ? "bg-accent text-background" : inMonth ? "text-foreground" : "text-foreground-faint"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, CHIP_LIMIT).map((e) => {
                    const time = new Date(e.when).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    });
                    const label = `${e.platform} via ${e.kind}: ${e.title}`;
                    const href = hrefFor(e);
                    const body = (
                      <>
                        <SocialBrandIcon platform={e.platform} className="h-3 w-3 shrink-0" />
                        <span className="truncate text-[10px] leading-tight tabular-nums text-foreground-muted">{time}</span>
                      </>
                    );
                    return href ? (
                      <a key={e.id} href={href} title={label} className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-surface-elevated">
                        {body}
                      </a>
                    ) : (
                      <button
                        key={e.id}
                        type="button"
                        title={label}
                        onClick={() => setOpenEvent(e)}
                        className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-elevated"
                      >
                        {body}
                      </button>
                    );
                  })}
                  {dayEvents.length > CHIP_LIMIT && (
                    <p className="px-1 text-[10px] font-medium text-foreground-subtle">
                      +{dayEvents.length - CHIP_LIMIT} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openEvent && (
        <ScheduledPostDialog
          event={openEvent}
          activeSlug={activeSlug}
          onClose={() => setOpenEvent(null)}
          onChanged={(newWhen) =>
            setList((prev) =>
              newWhen
                ? prev.map((x) => (x.id === openEvent.id ? { ...x, when: newWhen } : x))
                : prev.filter((x) => x.id !== openEvent.id),
            )
          }
        />
      )}
    </div>
  );
}
