// Each portal's calendar shows that portal's content and nothing else:
// SkateHive shows SkateHive, Gnars shows Gnars, and so on for Nogenta and
// KeepKey. Nesting in the sidebar (`switcher.parent`) is presentation only.
//
// The scoping is enforced server-side — `listCalendarExtras` and
// `listUnifiedCalendar` query a single `project.slug`. This guard is the second
// lock: if a query ever widens again, the calendars still won't paint another
// project's posts as if they were yours.

import type { CalendarExtra } from "@/app/actions/post-creator";

/** True when an event does NOT belong to the portal being viewed. Expected to
 *  be false for everything the server sends — a true here means a leak. */
export function isForeign(e: CalendarExtra, activeSlug: string): boolean {
  return !!activeSlug && !!e.projectSlug && e.projectSlug !== activeSlug;
}

/** The events a calendar for `activeSlug` may render. */
export function ownEvents(events: CalendarExtra[], activeSlug: string): CalendarExtra[] {
  return activeSlug ? events.filter((e) => !isForeign(e, activeSlug)) : events;
}
