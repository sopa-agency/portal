"use client";

// Reusable month-grid schedule calendar fed by unified CalendarExtra events
// (Instagram posts, suggestion/repo scheduled tweets, nested projects).
// Used on the Post Suggestions page; the Post Creator keeps its richer
// thumbnail calendar.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarExtra } from "@/app/actions/post-creator";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { ScheduledPostDialog } from "@/components/scheduled-post-dialog";

const CHIP_LIMIT = 3;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ScheduleCalendar({
  events,
  activeSlug,
}: {
  events: CalendarExtra[];
  activeSlug: string;
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

  const byDay = useMemo(() => {
    const map: Record<string, CalendarExtra[]> = {};
    for (const e of list) {
      const dt = new Date(e.when);
      if (Number.isNaN(dt.getTime())) continue;
      (map[dayKey(dt)] ??= []).push(e);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.when < b.when ? -1 : 1));
    return map;
  }, [list]);

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
          all scheduled posts across Instagram, suggestions and repo runs
          {events.some((e) => e.projectSlug !== activeSlug) ? " — nested projects included" : ""}
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
            return (
              <div
                key={key}
                className={`min-h-[76px] border-border p-1.5 ${idx % 7 !== 6 ? "border-r" : ""} ${idx < 35 ? "border-b" : ""} ${!inMonth ? "bg-surface-elevated/40" : ""}`}
              >
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
                    const label = `${e.platform} via ${e.kind} (${e.projectSlug}): ${e.title}`;
                    const href = hrefFor(e);
                    const body = (
                      <>
                        <SocialBrandIcon platform={e.platform} className="h-3 w-3 shrink-0" />
                        <span className="truncate text-[10px] leading-tight tabular-nums text-foreground-muted">{time}</span>
                        {e.projectSlug !== activeSlug && (
                          <span className="ml-auto shrink-0 rounded bg-surface-elevated px-1 text-[8px] uppercase tracking-wide text-foreground-faint">
                            {e.projectSlug.slice(0, 4)}
                          </span>
                        )}
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
