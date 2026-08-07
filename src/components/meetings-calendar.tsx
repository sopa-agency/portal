"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Repeat, Loader2, CalendarClock } from "lucide-react";
import { createMeeting, updateMeeting, deleteMeeting, improveMeeting, type MeetingDTO } from "@/app/actions/meetings";
import { type TaskDeadline } from "@/app/actions/kanban";
import { MEETING_AI_INSTRUCTION } from "@/lib/ai-prompts";
import { ImproveAiButton } from "@/components/improve-ai-button";
import { CopyButton } from "@/components/copy-button";
import { MeetingAtaPanel } from "@/components/meeting-ata-panel";
import { addSharedCalendar, deleteSharedCalendar, getAvailability, getCalendarConnectInfo, type SharedCalendarDTO, type BusyBlock, type TeamAvail } from "@/app/actions/shared-calendars";
import { useLocale } from "@/components/locale-provider";
import { SelectMenu } from "@/components/select-menu";
import { DateField } from "@/components/date-field";

type RosterMember = { username: string; email: string | null; avatarUrl: string; github?: string | null };

// Weekly meetings calendar (SOPA "Reuniões"). A Google-Calendar-style week grid:
// click an empty slot to create, click an event to edit/delete. "weekly" events
// repeat on the same weekday/time every week.

const DAY_START = 7; // 07:00
const DAY_END = 22; // 22:00
const DURATIONS = [
  { min: 15, label: "15 min" },
  { min: 30, label: "30 min" },
  { min: 60, label: "1 hora" },
  { min: 90, label: "1h30" },
  { min: 120, label: "2 horas" },
];
const HOUR_H = 48; // px per hour
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
const COLORS = ["#a3e635", "#38bdf8", "#f472b6", "#fbbf24", "#c084fc", "#34d399"];

/**
 * Stored colours are hex chosen for the dark grid. Each is a slot whose actual
 * shade comes from CSS, so the same meeting reads correctly in both themes
 * (see --evt-* in globals.css). Anything not in the palette — a legacy or
 * hand-set colour — is used as-is, with alpha appended for the fill.
 */
function eventColors(stored: string | null | undefined): { line: string; fill: string } {
  const i = stored ? COLORS.indexOf(stored) : -1;
  if (i >= 0) return { line: `var(--evt-${i + 1})`, fill: `var(--evt-${i + 1}-soft)` };
  if (!stored) return { line: "var(--accent)", fill: "var(--accent-bg)" };
  return { line: stored, fill: `${stored}22` };
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// datetime-local <-> Date
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Occurrence = { meeting: MeetingDTO; start: Date; end: Date; dayIndex: number };

// Lay out a day's events into side-by-side lanes only where they OVERLAP in
// time. A lone event in its time-slot fills the full cell width; a cluster of
// N overlapping events splits the width into N. Returns fractional left/width
// (0..1) per meeting id.
function computeLanes(occs: Occurrence[]): Map<string, { left: number; width: number }> {
  const out = new Map<string, { left: number; width: number }>();
  const sorted = [...occs].sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  const laneEnd: number[] = [];
  const lane = new Map<string, number>();
  let cluster: Occurrence[] = [];
  let clusterMaxEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const total = Math.max(...cluster.map((o) => (lane.get(o.meeting.id) ?? 0) + 1));
    for (const o of cluster) {
      const l = lane.get(o.meeting.id) ?? 0;
      out.set(o.meeting.id, { left: l / total, width: 1 / total });
    }
    cluster = [];
  };
  for (const o of sorted) {
    if (cluster.length && o.start.getTime() >= clusterMaxEnd) {
      flush();
      laneEnd.length = 0;
      clusterMaxEnd = -Infinity;
    }
    let placed = laneEnd.findIndex((end) => end <= o.start.getTime());
    if (placed === -1) { placed = laneEnd.length; laneEnd.push(0); }
    laneEnd[placed] = o.end.getTime();
    lane.set(o.meeting.id, placed);
    cluster.push(o);
    clusterMaxEnd = Math.max(clusterMaxEnd, o.end.getTime());
  }
  flush();
  return out;
}

// Where (if anywhere) a meeting shows in the visible week.
function occurrenceInWeek(m: MeetingDTO, weekStart: Date): Occurrence | null {
  const s = new Date(m.startsAt);
  const e = new Date(m.endsAt);
  const durMs = Math.max(15 * 60000, e.getTime() - s.getTime());
  if (m.weekly) {
    if (s.getTime() > addDays(weekStart, 7).getTime()) return null; // series starts later
    const day = addDays(weekStart, s.getDay());
    const start = new Date(day);
    start.setHours(s.getHours(), s.getMinutes(), 0, 0);
    return { meeting: m, start, end: new Date(start.getTime() + durMs), dayIndex: s.getDay() };
  }
  if (s.getTime() >= weekStart.getTime() && s.getTime() < addDays(weekStart, 7).getTime()) {
    return { meeting: m, start: s, end: e, dayIndex: s.getDay() };
  }
  return null;
}

// Does a meeting occur on a specific calendar day? Used by the month view.
function occurrenceOnDay(m: MeetingDTO, day: Date): { start: Date; end: Date } | null {
  const s = new Date(m.startsAt);
  const e = new Date(m.endsAt);
  const durMs = Math.max(15 * 60000, e.getTime() - s.getTime());
  const sameYMD = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (m.weekly) {
    if (day.getDay() !== s.getDay()) return null;
    const sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    if (day.getTime() < sDay.getTime()) return null; // series starts later
    const start = new Date(day);
    start.setHours(s.getHours(), s.getMinutes(), 0, 0);
    return { start, end: new Date(start.getTime() + durMs) };
  }
  return sameYMD(s, day) ? { start: s, end: e } : null;
}

type ProjectOption = { slug: string; name: string; members: RosterMember[] };
type Editor = {
  id: string | null;
  title: string;
  start: string;
  durationMin: number;
  notes: string;
  forProject: string;
  emailBody: string;
  kind: "plan" | "exec";
  owners: string[];
  color: string;
  weekly: boolean;
  attendees: string[];
  googleEventUrl?: string | null;
};

export function MeetingsCalendar({ initialMeetings, initialCalendars, deadlines = [], projects, defaultProject, accent, scopeToProject = false }: { initialMeetings: MeetingDTO[]; initialCalendars: SharedCalendarDTO[]; deadlines?: TaskDeadline[]; projects: ProjectOption[]; defaultProject: string; accent: string; scopeToProject?: boolean }) {
  const { locale, t: dict } = useLocale();
  const t = dict.meetings;
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";
  // Weekday headers, Sunday-first, from a known Sunday so the list can't drift.
  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(addDays(sunday, i)).replace(".", "").replace(/^./, (c) => c.toUpperCase()),
    );
  }, [intlLocale]);
  const hourLabel = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }),
    [intlLocale],
  );

  // Every quarter hour of the day. 96 rows is nothing to render, and the
  // select's typeahead means "14" jumps straight to 14:00.
  const timeOptions = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" });
    return Array.from({ length: 96 }, (_, i) => {
      const h = Math.floor(i / 4);
      const m = (i % 4) * 15;
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      return { value, label: fmt.format(new Date(2024, 0, 1, h, m)) };
    });
  }, [intlLocale]);

  const membersWithEmail = (slug: string) =>
    (projects.find((p) => p.slug === slug)?.members ?? []).filter((m): m is RosterMember & { email: string } => !!m.email);
  // Active portal's members → availability panel list.
  const invitable = useMemo(() => membersWithEmail(defaultProject), [projects, defaultProject]);
  const teamEmails = useMemo(() => invitable.map((m) => m.email), [invitable]);
  const [meetings, setMeetings] = useState<MeetingDTO[]>(initialMeetings);
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  // Which way the last move went, so the range label slides in from that side.
  const [dir, setDir] = useState(1);
  // Step the cursor by the active view's unit.
  const goTo = (step: -1 | 0 | 1) => {
    setDir(step === 0 ? 1 : step);
    if (step === 0) { setCursor(new Date()); return; }
    setCursor((c) => {
      const n = new Date(c);
      if (view === "day") n.setDate(n.getDate() + step);
      else if (view === "week") n.setDate(n.getDate() + step * 7);
      else n.setMonth(n.getMonth() + step);
      return n;
    });
  };
  const [editor, setEditor] = useState<null | Editor>(null);
  // Members selectable as attendees for the meeting being edited (its project).
  const editorMembers = useMemo(() => (editor ? membersWithEmail(editor.forProject) : []), [editor, projects]);
  const [aiBusy, setAiBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Prefill from the Kanban "Criar reunião EXEC" deep-link (?new=<base64 json>).
  useEffect(() => {
    const raw = searchParams.get("new");
    if (!raw) return;
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(raw)))) as {
        title?: string; forProject?: string; kind?: "plan" | "exec"; notes?: string; logins?: string[];
      };
      const slug = projects.find((p) => p.slug === data.forProject)?.slug ?? defaultProject;
      const logins = new Set((data.logins ?? []).map((l) => l.toLowerCase()));
      const emails = membersWithEmail(slug).filter((m) => m.github && logins.has(m.github)).map((m) => m.email);
      const start = new Date(Date.now() + 86400000);
      start.setHours(15, 0, 0, 0);
      setEditor({
        id: null, title: data.title ?? "", start: toLocalInput(start), durationMin: 60,
        notes: data.notes ?? "", forProject: slug, emailBody: "",
        kind: data.kind === "exec" ? "exec" : "plan", owners: emails,
        color: accent, weekly: false, attendees: emails,
      });
    } catch {
      /* bad payload — ignore */
    }
    router.replace("/reunioes"); // clear the param so a refresh doesn't reopen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [emailInput, setEmailInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Shared-calendar availability overlay.
  const [calendars, setCalendars] = useState<SharedCalendarDTO[]>(initialCalendars);
  const [showAvail, setShowAvail] = useState(true);
  const [busy, setBusy] = useState<BusyBlock[]>([]);
  const [availBusy, setAvailBusy] = useState(false);
  const [calPanel, setCalPanel] = useState(false);
  const [newCal, setNewCal] = useState({ name: "", icsUrl: "" });
  const [serviceEmail, setServiceEmail] = useState<string | null>(null);
  const [meetingsCal, setMeetingsCal] = useState<string | null>(null);
  const [teamAvail, setTeamAvail] = useState<TeamAvail[]>([]);
  // Per-member availability toggle (usernames hidden from the overlay), persisted.
  const [hiddenTeam, setHiddenTeam] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { const raw = localStorage.getItem("reunioes-hidden-team"); if (raw) setHiddenTeam(new Set(JSON.parse(raw) as string[])); } catch {}
  }, []);
  const toggleTeamMember = (u: string) =>
    setHiddenTeam((prev) => {
      const n = new Set(prev);
      if (n.has(u)) n.delete(u); else n.add(u);
      try { localStorage.setItem("reunioes-hidden-team", JSON.stringify([...n])); } catch {}
      return n;
    });

  // SA email + primary meetings calendar (loaded when the panel opens).
  useEffect(() => {
    if (!calPanel || serviceEmail !== null) return;
    getCalendarConnectInfo().then((r) => {
      setServiceEmail(r.ok ? (r.serviceEmail ?? "") : "");
      if (r.ok) setMeetingsCal(r.meetingsCalendar ?? "");
    });
  }, [calPanel, serviceEmail]);

  // Visible day columns for the time-grid (day = 1, week = 7).
  const days = useMemo(
    () => (view === "day" ? [new Date(cursor)] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))),
    [view, cursor, weekStart],
  );
  // Month grid: 6 weeks × 7 days covering the cursor's month (leading/trailing
  // days from adjacent months included for a full grid).
  const monthGrid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);
  const today = new Date();

  // Refetch availability (team roster auto-loads server-side + manual calendars)
  // when the week, the manual calendar set, or the show toggle changes.
  useEffect(() => {
    if (!showAvail) { setBusy([]); return; }
    let cancelled = false;
    setAvailBusy(true);
    getAvailability(weekStart.toISOString()).then((r) => {
      if (cancelled) return;
      setBusy(r.ok ? r.busy : []);
      setTeamAvail(r.ok ? r.team : []);
      setAvailBusy(false);
    });
    return () => { cancelled = true; };
  }, [weekStart, calendars, showAvail]);

  async function addCal() {
    if (!newCal.name.trim() || !newCal.icsUrl.trim()) return;
    const color = COLORS[calendars.length % COLORS.length];
    const r = await addSharedCalendar({ name: newCal.name, icsUrl: newCal.icsUrl, color });
    if (r.ok) { setCalendars((p) => [...p, r.calendar]); setNewCal({ name: "", icsUrl: "" }); }
    else setErr(r.error);
  }
  async function removeCal(id: string) {
    const r = await deleteSharedCalendar(id);
    if (r.ok) setCalendars((p) => p.filter((c) => c.id !== id));
  }
  const busyByDay = useMemo(() => {
    const m: Record<number, BusyBlock[]> = {};
    for (const b of busy) {
      // Skip team members the user toggled off.
      if (b.calendarId.startsWith("team:") && hiddenTeam.has(b.calendarId.slice(5))) continue;
      const di = new Date(b.start).getDay();
      (m[di] ??= []).push(b);
    }
    return m;
  }, [busy, hiddenTeam]);

  // Project filter — on a project's own page default to that project's meetings;
  // on the SOPA hub (scopeToProject=false) default to all.
  const [projFilter, setProjFilter] = useState<string>(scopeToProject ? defaultProject : "all");
  const visibleMeetings = useMemo(
    () => (projFilter === "all" ? meetings : meetings.filter((m) => (m.forProject ?? defaultProject) === projFilter)),
    [meetings, projFilter, defaultProject],
  );
  const occurrences = useMemo(
    () => visibleMeetings.map((m) => occurrenceInWeek(m, weekStart)).filter((o): o is Occurrence => o !== null),
    [visibleMeetings, weekStart],
  );

  const durationOptions = useMemo(() => {
    const base = DURATIONS.map((d) => ({ value: String(d.min), label: t.editor.durations[`m${d.min}` as keyof typeof t.editor.durations] }));
    const current = editor?.durationMin;
    // A meeting saved with an odd length keeps its own row rather than
    // silently snapping to the nearest preset when you open it.
    return current && !DURATIONS.some((d) => d.min === current)
      ? [...base, { value: String(current), label: t.editor.customDuration(current) }].sort((a, b) => Number(a.value) - Number(b.value))
      : base;
  }, [editor?.durationMin, t]);

  // Kept mounted through the close so the exit animates; see .dialog-panel.
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => {
    if (!editor) return;
    // Next frame, so the panel paints closed once and then transitions.
    const id = requestAnimationFrame(() => setEditorOpen(true));
    return () => cancelAnimationFrame(id);
  }, [editor]);
  function closeEditor() {
    setEditorOpen(false);
    window.setTimeout(() => setEditor(null), 200);
  }

  function openNew(day: Date, hour: number) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    setErr(null);
    setEditor({ id: null, title: "", start: toLocalInput(start), durationMin: 60, notes: "", forProject: defaultProject, emailBody: "", kind: "plan", owners: [], color: accent, weekly: false, attendees: [] });
    setEmailInput("");
  }
  function openEdit(m: MeetingDTO) {
    setErr(null);
    setEmailInput("");
    setEditor({
      id: m.id,
      title: m.title,
      start: toLocalInput(new Date(m.startsAt)),
      durationMin: Math.max(15, Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60000)),
      notes: m.notes ?? "",
      forProject: m.forProject ?? defaultProject,
      emailBody: m.emailBody ?? "",
      kind: m.kind,
      owners: m.owners ?? [],
      color: m.color ?? accent,
      weekly: m.weekly,
      attendees: m.attendees ?? [],
      googleEventUrl: m.googleEventUrl,
    });
  }
  function toggleAttendee(email: string) {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setEditor((ed) =>
      ed
        ? {
            ...ed,
            attendees: ed.attendees.includes(e) ? ed.attendees.filter((a) => a !== e) : [...ed.attendees, e],
            // dropping an attendee also drops them as owner
            owners: ed.attendees.includes(e) ? ed.owners.filter((o) => o !== e) : ed.owners,
          }
        : ed,
    );
  }
  function toggleOwner(email: string) {
    const e = email.trim().toLowerCase();
    setEditor((ed) =>
      ed ? { ...ed, owners: ed.owners.includes(e) ? ed.owners.filter((o) => o !== e) : [...ed.owners, e] } : ed,
    );
  }
  // When switching the meeting's project, drop attendees/owners not in it.
  function setForProject(slug: string) {
    setEditor((ed) => {
      if (!ed) return ed;
      const emails = new Set(membersWithEmail(slug).map((m) => m.email));
      return {
        ...ed,
        forProject: slug,
        attendees: ed.attendees.filter((a) => emails.has(a)),
        owners: ed.owners.filter((o) => emails.has(o)),
      };
    });
  }
  async function improveWithAI(instruction?: string) {
    if (!editor) return;
    setAiBusy(true);
    setErr(null);
    const r = await improveMeeting({
      title: editor.title,
      notes: editor.notes,
      kind: editor.kind,
      forProject: projects.find((p) => p.slug === editor.forProject)?.name ?? editor.forProject,
      when: new Date(editor.start).toLocaleString(intlLocale, { dateStyle: "full", timeStyle: "short" }),
      attendees: editor.attendees,
      owners: editor.owners,
      instruction,
    });
    setAiBusy(false);
    if (r.ok) setEditor((ed) => (ed ? { ...ed, notes: r.agenda || ed.notes, emailBody: r.email || ed.emailBody } : ed));
    else setErr(r.error);
  }

  async function save() {
    if (!editor) return;
    if (!editor.title.trim()) { setErr(t.editor.needTitle); return; }
    setSaving(true);
    setErr(null);
    const startsAt = new Date(editor.start).toISOString();
    const endsAt = new Date(new Date(editor.start).getTime() + editor.durationMin * 60000).toISOString();
    const common = { title: editor.title, startsAt, endsAt, notes: editor.notes, forProject: editor.forProject, emailBody: editor.emailBody, kind: editor.kind, owners: editor.owners, color: editor.color, weekly: editor.weekly, attendees: editor.attendees };
    if (editor.id) {
      const r = await updateMeeting(editor.id, common, true);
      if (r.ok) {
        setMeetings((prev) => prev.map((m) => (m.id === r.meeting.id ? r.meeting : m)));
        closeEditor();
        const notes = [r.inviteError && t.editor.inviteError(r.inviteError), r.calendarError && t.editor.googleError(r.calendarError)].filter(Boolean);
        if (notes.length) setToast(notes.join(" · "));
      } else setErr(r.error);
    } else {
      const r = await createMeeting(common);
      if (r.ok) {
        setMeetings((prev) => [...prev, r.meeting]);
        closeEditor();
        const parts: string[] = [t.editor.created];
        if (editor.attendees.length) parts.push(r.inviteError ? t.editor.invitesFailed(r.inviteError) : t.editor.invitesSent(r.invited ?? 0));
        if (r.calendarError) parts.push(t.editor.googleError(r.calendarError));
        if (parts.length > 1) setToast(parts.join(" · "));
      } else setErr(r.error);
    }
    setSaving(false);
  }
  async function remove() {
    if (!editor?.id) return;
    setSaving(true);
    const r = await deleteMeeting(editor.id);
    if (r.ok) { setMeetings((prev) => prev.filter((m) => m.id !== editor.id)); closeEditor(); }
    else setErr(r.error);
    setSaving(false);
  }

  const rangeLabel =
    view === "day"
      ? cursor.toLocaleDateString(intlLocale, { weekday: "short", day: "2-digit", month: "short" })
      : view === "month"
        ? cursor.toLocaleDateString(intlLocale, { month: "long", year: "numeric" })
        : `${days[0].toLocaleDateString(intlLocale, { day: "2-digit", month: "short" })} – ${days[6].toLocaleDateString(intlLocale, { day: "2-digit", month: "short" })}`;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-3 md:h-[calc(100dvh-4rem)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-foreground">{t.title}</h1>
          <p className="text-[11px] text-foreground-faint">{t.subtitle}</p>
          {/* Project filter */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => setProjFilter("all")} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${projFilter === "all" ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"}`}>
              {t.all} <span className="text-foreground-faint">({meetings.length})</span>
            </button>
            {projects
              .map((p) => ({ p, n: meetings.filter((m) => (m.forProject ?? defaultProject) === p.slug).length }))
              .filter((x) => x.n > 0 || x.p.slug === defaultProject)
              .map(({ p, n }) => (
                <button key={p.slug} type="button" onClick={() => setProjFilter(p.slug)} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${projFilter === p.slug ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"}`}>
                  {p.name} <span className="text-foreground-faint">({n})</span>
                </button>
              ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View switcher */}
          {/* One pill slides between three equal cells — the old version blinked
              a background on and off, which read as three separate controls. */}
          <div className="relative grid grid-cols-3 rounded-lg border border-border p-0.5 text-xs">
            <span
              aria-hidden="true"
              className="seg-indicator absolute inset-y-0.5 left-0.5 rounded-md bg-accent-bg"
              style={{ width: "calc((100% - 0.25rem) / 3)", transform: `translateX(${["day", "week", "month"].indexOf(view) * 100}%)` }}
            />
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`relative z-10 rounded-md px-2.5 py-1 font-medium transition-colors ${view === v ? "text-accent" : "text-foreground-muted hover:text-foreground"}`}
              >
                {t.views[v]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => goTo(0)} className="auth-action rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground">{t.today}</button>
          <div className="flex items-center rounded-lg border border-border">
            <button type="button" onClick={() => goTo(-1)} aria-label={t.prev} className="rounded-l-lg px-2 py-1.5 text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
            {/* Keyed by the label so the animation replays on every move, and by
                direction so it slides in from the side you came from. */}
            <span key={rangeLabel} className="cal-range w-36 text-center text-xs font-medium capitalize text-foreground" style={{ "--range-from": `${dir * 6}px` } as CSSProperties}>
              {rangeLabel}
            </span>
            <button type="button" onClick={() => goTo(1)} aria-label={t.next} className="rounded-r-lg px-2 py-1.5 text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="relative">
            <button type="button" onClick={() => setCalPanel((o) => !o)} className="auth-action flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"><CalendarClock className="h-3.5 w-3.5" /> {t.availability.action}{(() => { const n = teamAvail.filter((t) => t.status === "ok").length + calendars.length; return n ? ` (${n})` : ""; })()}{availBusy && <Loader2 className="h-3 w-3 animate-spin" />}</button>
            {calPanel && (
              <div className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-80 rounded-xl border border-border bg-surface-elevated p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">{t.availability.title}</span>
                  <label className="flex items-center gap-1 text-[10px] text-foreground-muted"><input type="checkbox" checked={showAvail} onChange={(e) => setShowAvail(e.target.checked)} /> {t.availability.show}</label>
                </div>

                {/* Team members (auto-loaded from the central roster) */}
                {invitable.length > 0 && (
                  <div className="mb-2 max-h-44 space-y-1 overflow-auto">
                    {invitable.map((m) => {
                      const st = teamAvail.find((t) => t.username === m.username);
                      const dot = st?.color ?? "var(--accent)";
                      const label = !st ? (availBusy ? t.availability.checking : "—") : st.status === "ok" ? t.availability.connected : st.status === "notShared" ? t.availability.notShared : t.availability.error;
                      const labelClass = st?.status === "ok" ? "text-success" : st?.status === "notShared" ? "text-foreground-faint" : st?.status === "error" ? "text-warning" : "text-foreground-faint";
                      const shown = !hiddenTeam.has(m.username);
                      return (
                        <label key={m.username} className="flex cursor-pointer items-center gap-2 text-xs" title={st?.detail ?? m.email}>
                          <input type="checkbox" checked={shown} onChange={() => toggleTeamMember(m.username)} className="shrink-0" />
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st?.status === "ok" ? dot : "transparent", border: st?.status === "ok" ? undefined : `1.5px solid ${dot}`, opacity: shown ? 1 : 0.4 }} />
                          <span className={`min-w-0 flex-1 truncate ${shown ? "text-foreground" : "text-foreground-faint line-through"}`}>{m.username}</span>
                          <span className={`shrink-0 text-[10px] ${labelClass}`}>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {invitable.length === 0 && <p className="mb-2 text-[11px] text-foreground-faint">{t.availability.none}</p>}

                {/* Manually-added extra calendars (people outside the team / iCal feeds) */}
                {calendars.length > 0 && (
                  <div className="space-y-1.5 border-t border-border pt-2">
                    <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">{t.availability.extras}</span>
                    {calendars.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-xs">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? "var(--accent)" }} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                        <button type="button" onClick={() => removeCal(c.id)} className="text-foreground-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {serviceEmail ? (
                  <div className="mt-2 rounded-md border border-border bg-surface p-2 text-[10px] text-foreground-muted">
                    {t.availability.sharePrefix} <span className="text-success">{t.availability.connected}</span>, {t.availability.shareSuffix}
                    <CopyButton value={serviceEmail} className="mt-1 flex w-full items-center gap-1 truncate rounded bg-surface-elevated px-1.5 py-1 text-left font-mono text-[10px] text-accent hover:underline">{serviceEmail}</CopyButton>
                  </div>
                ) : null}
                {meetingsCal ? (
                  <div className="mt-2 rounded-md border border-border bg-surface p-2 text-[10px] text-foreground-muted">
                    {t.availability.createdIn} <span className="font-mono text-foreground-subtle">{meetingsCal}</span>
                  </div>
                ) : null}
                <details className="mt-2 border-t border-border pt-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-foreground-subtle">{t.availability.addExtra}</summary>
                  <div className="mt-1.5 space-y-1.5">
                    <input value={newCal.name} onChange={(e) => setNewCal({ ...newCal, name: e.target.value })} placeholder={t.availability.namePlaceholder} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
                    <input value={newCal.icsUrl} onChange={(e) => setNewCal({ ...newCal, icsUrl: e.target.value })} placeholder={t.availability.icsPlaceholder} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
                    <button type="button" onClick={addCal} className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90">{t.availability.addAction}</button>
                  </div>
                </details>
              </div>
            )}
          </div>
          <button type="button" onClick={() => openNew(today, Math.max(DAY_START, Math.min(DAY_END - 1, today.getHours())))} className="auth-action flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"><Plus className="h-3.5 w-3.5" /> {t.newMeeting}</button>
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs text-accent">
          {toast}
          <button type="button" onClick={() => setToast(null)} aria-label={t.dismiss}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface">
        {view !== "month" ? (
        <>
        {/* Day header */}
        <div className="sticky top-0 z-10 grid border-b border-border bg-surface" style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div key={i} className={`border-l border-border px-1 py-1.5 text-center ${isToday ? "bg-accent-bg" : ""}`}>
                <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">{dayNames[d.getDay()]}</div>
                <div className={`text-sm font-semibold ${isToday ? "text-accent" : "text-foreground"}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }}>
          {/* hour gutter */}
          <div>
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_H, borderColor: "var(--cal-line)" }} className="relative border-b">
                <span className="absolute -top-1.5 right-1 text-[10px] text-foreground-faint">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
          {/* day columns */}
          {days.map((day, di) => (
            <div key={di} className="relative border-l" style={{ borderColor: "var(--cal-line-strong)" }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_H, borderColor: "var(--cal-line)" }}
                  onClick={() => openNew(day, h)}
                  title={t.slotHint}
                  className="cal-slot group/slot flex items-start justify-end border-b p-1"
                >
                  <Plus className="cal-slot-hint h-3 w-3 text-accent" aria-hidden="true" />
                </div>
              ))}
              {/* availability (busy) blocks behind meetings — no titles, just busy */}
              {showAvail && (busyByDay[days[di].getDay()] ?? []).map((b, bi) => {
                const s = new Date(b.start);
                const e = new Date(b.end);
                const top = ((s.getHours() + s.getMinutes() / 60) - DAY_START) * HOUR_H;
                const height = Math.max(14, ((e.getTime() - s.getTime()) / 3600000) * HOUR_H);
                // A hex from the server keeps its alpha suffixes; the fallback
                // has to be whole values, since you can't concatenate onto a var().
                const busyStyle = b.color
                  ? { backgroundColor: `${b.color}1f`, borderColor: `${b.color}66` }
                  : { backgroundColor: "var(--accent-bg)", borderColor: "var(--accent-border)" };
                return (
                  <div
                    key={`busy-${bi}`}
                    title={b.title ? `${b.name}: ${b.title}` : t.availability.busy(b.name)}
                    style={{ top: Math.max(0, top), height, ...busyStyle }}
                    className="pointer-events-none absolute left-1 right-1 z-0 overflow-hidden rounded-md border border-dashed px-1 text-[9px] leading-tight text-foreground-faint"
                  >
                    {b.title ? `${b.name}: ${b.title}` : b.name}
                  </div>
                );
              })}
              {/* events for this day — lane-split only where they overlap */}
              {(() => {
                const dayOccs = occurrences.filter((o) => o.dayIndex === days[di].getDay());
                const lanes = computeLanes(dayOccs);
                return dayOccs.map((o) => {
                const top = ((o.start.getHours() + o.start.getMinutes() / 60) - DAY_START) * HOUR_H;
                const height = Math.max(20, ((o.end.getTime() - o.start.getTime()) / 3600000) * HOUR_H);
                const c = eventColors(o.meeting.color);
                const pos = lanes.get(o.meeting.id) ?? { left: 0, width: 1 };
                return (
                  <button
                    key={o.meeting.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEdit(o.meeting); }}
                    style={{
                      top: Math.max(0, top),
                      height,
                      left: `calc(${pos.left * 100}% + 2px)`,
                      width: `calc(${pos.width * 100}% - 4px)`,
                      backgroundColor: c.fill,
                      borderColor: c.line,
                    }}
                    className="cal-event absolute z-10 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left"
                  >
                    <div className="flex items-center gap-1 truncate text-[11px] font-semibold text-foreground">
                      {o.meeting.weekly && <Repeat className="h-2.5 w-2.5 shrink-0 text-foreground-subtle" />}
                      <span className={`shrink-0 rounded px-1 text-[8px] font-bold uppercase ${o.meeting.kind === "exec" ? "bg-warning/20 text-warning" : "bg-foreground/10 text-foreground-subtle"}`}>{o.meeting.kind}</span>
                      {o.meeting.title}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      {hourLabel.format(o.start)}
                      {o.meeting.kind === "exec" && o.meeting.owners.length > 0 && <span className="truncate text-accent">· {t.owners(o.meeting.owners.length)}</span>}
                    </div>
                  </button>
                );
                });
              })()}
            </div>
          ))}
        </div>
        </>
        ) : (
          /* MONTH VIEW — day cells with event chips */
          <div>
            <div className="grid grid-cols-7 border-b border-border bg-surface">
              {dayNames.map((n) => (
                <div key={n} className="border-l px-1 py-1.5 text-center text-[10px] uppercase tracking-wide text-foreground-subtle" style={{ borderColor: "var(--cal-line-strong)" }}>{n}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthGrid.map((day, i) => {
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameDay(day, today);
                const dayMeetings = visibleMeetings
                  .map((m) => { const o = occurrenceOnDay(m, day); return o ? { m, start: o.start } : null; })
                  .filter((x): x is { m: MeetingDTO; start: Date } => x !== null)
                  .sort((a, b) => a.start.getTime() - b.start.getTime());
                const pad = (n: number) => String(n).padStart(2, "0");
                const ymd = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
                const dayDeadlines = deadlines.filter((d) => d.deadline === ymd);
                return (
                  <div
                    key={i}
                    onClick={() => openNew(day, 9)}
                    style={{ borderColor: "var(--cal-line-strong)", backgroundColor: inMonth ? undefined : "var(--cal-outside)" }}
                    className="cal-slot min-h-[88px] cursor-pointer border-b border-l p-1"
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setView("day"); setCursor(new Date(day)); }}
                      className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-accent text-accent-foreground" : inMonth ? "text-foreground hover:bg-foreground/10" : "text-foreground-faint"}`}
                    >
                      {day.getDate()}
                    </button>
                    <div className="space-y-0.5">
                      {dayMeetings.slice(0, 3).map(({ m, start }) => {
                        const c = eventColors(m.color);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEdit(m); }}
                            style={{ backgroundColor: c.fill, borderColor: c.line }}
                            className="cal-event flex w-full items-center gap-1 overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[10px] leading-tight text-foreground"
                          >
                            <span className="shrink-0 text-foreground-subtle">{hourLabel.format(start)}</span>
                            <span className="min-w-0 flex-1 truncate">{m.title}</span>
                          </button>
                        );
                      })}
                      {dayMeetings.length > 3 && (
                        <div className="px-1 text-[10px] text-foreground-faint">{t.moreEvents(dayMeetings.length - 3)}</div>
                      )}
                      {/* Task deadlines due this day */}
                      {dayDeadlines.slice(0, 3).map((d) => {
                        const overdue = ymd < `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
                        return (
                          <a
                            key={d.itemId}
                            href={`/kanban?open=${encodeURIComponent(d.itemId)}`}
                            onClick={(e) => e.stopPropagation()}
                            title={`${t.deadlineTitle}${d.firePriority ? ` · 🔥${d.firePriority}` : ""}: ${d.title}${d.board ? ` (${d.board})` : ""}`}
                            className={`flex w-full items-center gap-1 overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[10px] leading-tight hover:brightness-110 ${overdue ? "border-danger bg-danger/10 text-danger" : "border-warning bg-warning/10 text-warning"}`}
                          >
                            <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                            {d.firePriority ? <span className="shrink-0">{"🔥".repeat(d.firePriority)}</span> : null}
                            <span className="min-w-0 flex-1 truncate">{d.title}</span>
                          </a>
                        );
                      })}
                      {dayDeadlines.length > 3 && (
                        <div className="px-1 text-[10px] text-foreground-faint">{t.moreDeadlines(dayDeadlines.length - 3)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Editor */}
      {editor && (
        <div
          className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          data-open={editorOpen}
          onClick={closeEditor}
        >
          <div
            className={`dialog-panel max-h-[92vh] w-full space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl ${editor.id ? "max-w-3xl" : "max-w-lg"}`}
            data-open={editorOpen}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">{editor.id ? t.editor.editTitle : t.editor.createTitle}</h2>
              <button type="button" onClick={closeEditor} aria-label={t.editor.close} className="rounded-md p-1 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <input
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              placeholder={t.editor.titlePlaceholder}
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            {/* Project + type */}
            <div className="flex gap-2 text-xs">
              <div className="flex-1 space-y-1">
                <span className="text-foreground-muted">{t.editor.project}</span>
                <SelectMenu
                  size="sm"
                  value={editor.forProject}
                  options={projects.map((p) => ({ value: p.slug, label: p.name }))}
                  onChange={setForProject}
                  placeholder={t.editor.project}
                  label={t.editor.project}
                  className="w-full"
                />
              </div>
              <div className="flex-1 space-y-1">
                <span className="text-foreground-muted">{t.editor.kind}</span>
                <SelectMenu
                  size="sm"
                  value={editor.kind}
                  options={[
                    { value: "plan", label: t.editor.kinds.plan },
                    { value: "exec", label: t.editor.kinds.exec },
                  ]}
                  onChange={(v) => setEditor({ ...editor, kind: v as "plan" | "exec" })}
                  placeholder={t.editor.kind}
                  label={t.editor.kind}
                  className="w-full"
                />
              </div>
            </div>
            {/* datetime-local hands the whole thing to the browser: its own
                calendar, its own clock, neither themeable. Split into the two
                pickers the rest of the app already uses. */}
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="min-w-[9rem] flex-1 space-y-1">
                <span className="text-foreground-muted">{t.editor.date}</span>
                <DateField
                  value={editor.start.slice(0, 10)}
                  onChange={(next) => next && setEditor({ ...editor, start: `${next}T${editor.start.slice(11, 16)}` })}
                  className="w-full"
                />
              </div>
              <div className="min-w-[7rem] flex-1 space-y-1">
                <span className="text-foreground-muted">{t.editor.time}</span>
                <SelectMenu
                  size="sm"
                  value={editor.start.slice(11, 16)}
                  options={timeOptions}
                  onChange={(v) => setEditor({ ...editor, start: `${editor.start.slice(0, 10)}T${v}` })}
                  placeholder={t.editor.time}
                  label={t.editor.time}
                  className="w-full"
                />
              </div>
              <div className="min-w-[7rem] flex-1 space-y-1">
                <span className="text-foreground-muted">{t.editor.duration}</span>
                <SelectMenu
                  size="sm"
                  value={String(editor.durationMin)}
                  options={durationOptions}
                  onChange={(v) => setEditor({ ...editor, durationMin: Number(v) })}
                  placeholder={t.editor.duration}
                  label={t.editor.duration}
                  className="w-full"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground-muted">
              <input type="checkbox" checked={editor.weekly} onChange={(e) => setEditor({ ...editor, weekly: e.target.checked })} />
              <Repeat className="h-3.5 w-3.5" /> {t.editor.weekly}
            </label>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c, i) => {
                // The swatch shows the shade this theme will actually paint,
                // so what you pick is what you get — the stored hex is the same
                // either way.
                const shade = `var(--evt-${i + 1})`;
                const on = editor.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditor({ ...editor, color: c })}
                    className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${on ? "ring-2 ring-offset-2 ring-offset-surface" : ""}`}
                    style={{ backgroundColor: shade, boxShadow: on ? `0 0 0 2px ${shade}` : undefined }}
                    aria-pressed={on}
                    aria-label={t.editor.color(c)}
                  />
                );
              })}
            </div>

            {/* Attendees — everyone's invited; EXEC meetings highlight owners (★) as responsible */}
            <div className="space-y-1.5">
              <span className="text-xs text-foreground-muted">
                {t.editor.attendees} · {projects.find((p) => p.slug === editor.forProject)?.name}
                {editor.kind === "exec" ? t.editor.ownerHint : ""}
              </span>
              {editorMembers.length > 0 ? (
                <div className="flex max-h-28 flex-wrap gap-1 overflow-auto">
                  {editorMembers.map((m) => {
                    const on = editor.attendees.includes(m.email);
                    const owner = editor.owners.includes(m.email);
                    return (
                      <span key={m.username} className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${on ? (owner ? "border-accent bg-accent text-accent-foreground" : "border-accent bg-accent-bg text-accent") : "border-border text-foreground-muted"}`}>
                        <button type="button" onClick={() => toggleAttendee(m.email)} title={m.email} className="flex items-center gap-1 hover:opacity-80">
                          <img src={m.avatarUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                          {m.username}
                        </button>
                        {editor.kind === "exec" && on && (
                          <button type="button" onClick={() => toggleOwner(m.email)} title={owner ? t.editor.owner : t.editor.makeOwner} className="leading-none">{owner ? "★" : "☆"}</button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-foreground-faint">{t.editor.noMembers}</p>
              )}
              {editor.attendees.filter((a) => !editorMembers.some((m) => m.email === a)).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {editor.attendees.filter((a) => !editorMembers.some((m) => m.email === a)).map((a) => (
                    <button key={a} type="button" onClick={() => toggleAttendee(a)} className="rounded-full border border-accent bg-accent-bg px-2 py-0.5 text-[10px] text-accent">{a} ×</button>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (/@/.test(emailInput)) { toggleAttendee(emailInput); setEmailInput(""); } } }}
                  placeholder={t.editor.emailPlaceholder}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
                />
                <button type="button" onClick={() => { if (/@/.test(emailInput)) { toggleAttendee(emailInput); setEmailInput(""); } }} className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground">{t.editor.add}</button>
              </div>
            </div>

            {/* Pauta + Improve with AI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground-muted">{t.editor.agenda}</span>
                <ImproveAiButton busy={aiBusy} defaultInstruction={MEETING_AI_INSTRUCTION} onRun={(instr) => improveWithAI(instr)} />
              </div>
              <textarea
                value={editor.notes}
                onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                rows={3}
                placeholder={t.editor.agendaPlaceholder}
                className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
              />
            </div>

            {/* Invite email (AI-fillable, editable) */}
            <details className="rounded-lg border border-border bg-surface-elevated p-2" open={!!editor.emailBody}>
              <summary className="cursor-pointer text-xs text-foreground-muted">{t.editor.inviteEmail} {editor.emailBody ? t.editor.inviteCustom : t.editor.inviteDefault}</summary>
              <textarea
                value={editor.emailBody}
                onChange={(e) => setEditor({ ...editor, emailBody: e.target.value })}
                rows={4}
                placeholder={t.editor.inviteEmailPlaceholder}
                className="mt-1.5 w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
              />
            </details>
            {editor.id && editor.googleEventUrl && (
              <a href={editor.googleEventUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> {t.editor.openInGoogle}
              </a>
            )}
            {/* Post-meeting: ata + action items + Kanban cards (existing meetings only) */}
            {editor.id && (() => {
              const m = meetings.find((x) => x.id === editor.id);
              return m ? (
                <MeetingAtaPanel
                  meeting={m}
                  projects={projects}
                  onUpdated={(updated) => setMeetings((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                />
              ) : null;
            })()}
            {err && <p className="text-xs text-danger">{err}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={save} disabled={saving} className="auth-action flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.editor.save}
              </button>
              {editor.id && (
                <button type="button" onClick={remove} disabled={saving} aria-label={t.editor.delete} title={t.editor.delete} className="auth-action flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
