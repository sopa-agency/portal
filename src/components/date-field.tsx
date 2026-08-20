"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnchoredPopover } from "@/components/anchored-popover";
import { useLocale } from "@/components/locale-provider";

/**
 * Date picker over a `yyyy-mm-dd` string — the shape GitHub's date field takes,
 * and what `<input type="date">` produced before this.
 *
 * The native input was replaced for the same reason as the native select: the
 * calendar is drawn by the browser, so it can't be themed, can't be animated,
 * and looks nothing like the rest of the board. What it DID have was keyboard
 * access, so this re-implements it properly — arrows walk days and weeks,
 * PageUp/PageDown walk months, Enter picks.
 *
 * Every conversion is deliberately local-time: `new Date("2026-08-07")` parses
 * as UTC and lands on the 6th for anyone west of Greenwich, which is exactly
 * the kind of off-by-one a deadline field must not have.
 */

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function DateField({
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  /** `yyyy-mm-dd`, or "" for none. */
  value: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const selected = fromISO(value);
  const today = new Date();
  // The day the keyboard is on. Also decides which month the grid shows.
  const [cursor, setCursor] = useState<Date>(selected ?? today);

  const close = useCallback(() => setOpen(false), []);
  const closeAndReturn = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  function openCalendar() {
    setCursor(fromISO(value) ?? new Date());
    setOpen(true);
  }

  function pick(day: Date) {
    onChange(toISO(day));
    closeAndReturn();
  }

  // Focus follows the cursor (roving tabindex) so arrow keys read naturally in
  // a screen reader: each landing announces the day it moved to.
  useEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>('[data-cursor="true"]');
    el?.focus();
  }, [open, cursor]);

  /** Full date, for each day's accessible name — "7 de agosto de 2026". */
  const longDate = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "long", year: "numeric" }),
    [intlLocale],
  );

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(cursor),
    [intlLocale, cursor],
  );

  // Weekday initials, Sunday-first, taken from a known Sunday so the list can't
  // drift with the current date.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "narrow" });
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, i) => fmt.format(addDays(sunday, i)));
  }, [intlLocale]);

  // Six fixed rows: the grid never changes height as you page through months,
  // so the panel doesn't jump under the pointer.
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  function onGridKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      setCursor((c) => addDays(c, moves[e.key]));
      return;
    }
    switch (e.key) {
      case "PageUp":
        e.preventDefault();
        setCursor((c) => addMonths(c, -1));
        break;
      case "PageDown":
        e.preventDefault();
        setCursor((c) => addMonths(c, 1));
        break;
      case "Home":
        e.preventDefault();
        setCursor((c) => addDays(c, -c.getDay()));
        break;
      case "End":
        e.preventDefault();
        setCursor((c) => addDays(c, 6 - c.getDay()));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(cursor);
        break;
      case "Tab":
        // Focus is in a portal, outside whatever dialog is hosting the field —
        // hand it back to the trigger rather than let Tab wander out of it.
        e.preventDefault();
        closeAndReturn();
        break;
    }
  }

  const display = selected
    ? new Intl.DateTimeFormat(intlLocale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(selected)
    : t.ui.date.empty;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={t.ui.date.open}
        disabled={disabled}
        onClick={() => (open ? close() : openCalendar())}
        className={`flex items-center gap-1.5 rounded-lg border bg-surface px-2 py-1 text-xs outline-none transition-colors disabled:opacity-50 ${
          open ? "border-accent-border text-foreground" : "border-border hover:border-border-strong"
        } ${selected ? "text-foreground" : "text-foreground-faint"} ${className}`}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-foreground-faint" aria-hidden="true" />
        <span className="tabular-nums">{display}</span>
      </button>

      <AnchoredPopover open={open} onClose={close} anchorRef={triggerRef} className="w-[17rem] p-2">
        <div className="mb-1 flex items-center justify-between gap-1">
          <button
            type="button"
            aria-label={t.ui.date.prevMonth}
            onClick={() => setCursor((c) => addMonths(c, -1))}
            className="rounded-md p-1 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-semibold capitalize text-foreground">{monthLabel}</span>
          <button
            type="button"
            aria-label={t.ui.date.nextMonth}
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="rounded-md p-1 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 pb-1">
          {weekdays.map((w, i) => (
            <span key={i} className="py-1 text-center text-[10px] font-medium uppercase text-foreground-faint">
              {w}
            </span>
          ))}
        </div>

        {/* A plain group of buttons rather than role="grid": a real grid owes
            the a11y tree row elements, and this is a CSS grid of 42 buttons
            with no rows in the markup. Each day carries its full date as its
            accessible name, so arrowing around still reads correctly. */}
        <div ref={gridRef} role="group" aria-label={monthLabel} onKeyDown={onGridKeyDown} className="grid grid-cols-7 gap-0.5">
          {cells.map((day) => {
            const isSelected = !!selected && sameDay(day, selected);
            const isToday = sameDay(day, today);
            const isCursor = sameDay(day, cursor);
            const outside = day.getMonth() !== cursor.getMonth();
            return (
              <button
                key={day.getTime()}
                type="button"
                data-cursor={isCursor}
                tabIndex={isCursor ? 0 : -1}
                aria-label={longDate.format(day)}
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
                onClick={() => pick(day)}
                className={`rounded-md py-1 text-xs tabular-nums outline-none transition-colors ${
                  isSelected
                    ? "bg-accent font-semibold text-accent-foreground"
                    : outside
                      ? "text-foreground-faint hover:bg-foreground/5"
                      : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground"
                } ${isToday && !isSelected ? "ring-1 ring-inset ring-accent-border" : ""} ${
                  isCursor && !isSelected ? "bg-foreground/5" : ""
                }`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              closeAndReturn();
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-foreground-subtle transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {t.ui.date.clear}
          </button>
          <button
            type="button"
            onClick={() => pick(new Date())}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent-bg"
          >
            {t.ui.date.today}
          </button>
        </div>
      </AnchoredPopover>
    </>
  );
}
