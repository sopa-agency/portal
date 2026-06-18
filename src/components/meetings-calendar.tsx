"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Repeat, Loader2, CalendarClock } from "lucide-react";
import { createMeeting, updateMeeting, deleteMeeting, improveMeeting, type MeetingDTO } from "@/app/actions/meetings";
import { MEETING_AI_INSTRUCTION } from "@/lib/ai-prompts";
import { ImproveAiButton } from "@/components/improve-ai-button";
import { addSharedCalendar, deleteSharedCalendar, getAvailability, getCalendarConnectInfo, type SharedCalendarDTO, type BusyBlock, type TeamAvail } from "@/app/actions/shared-calendars";

type RosterMember = { username: string; email: string | null; avatarUrl: string };

// Weekly meetings calendar (SOPA "Reuniões"). A Google-Calendar-style week grid:
// click an empty slot to create, click an event to edit/delete. "weekly" events
// repeat on the same weekday/time every week.

const DAY_START = 7; // 07:00
const DAY_END = 22; // 22:00
const HOUR_H = 48; // px per hour
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const COLORS = ["#a3e635", "#38bdf8", "#f472b6", "#fbbf24", "#c084fc", "#34d399"];

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

type ProjectOption = { slug: string; name: string; members: RosterMember[] };
type Editor = {
  id: string | null;
  title: string;
  start: string;
  end: string;
  notes: string;
  forProject: string;
  emailBody: string;
  kind: "plan" | "exec";
  owners: string[];
  color: string;
  weekly: boolean;
  attendees: string[];
};

export function MeetingsCalendar({ initialMeetings, initialCalendars, projects, defaultProject, accent }: { initialMeetings: MeetingDTO[]; initialCalendars: SharedCalendarDTO[]; projects: ProjectOption[]; defaultProject: string; accent: string }) {
  const membersWithEmail = (slug: string) =>
    (projects.find((p) => p.slug === slug)?.members ?? []).filter((m): m is RosterMember & { email: string } => !!m.email);
  // Active portal's members → availability panel list.
  const invitable = useMemo(() => membersWithEmail(defaultProject), [projects, defaultProject]);
  const teamEmails = useMemo(() => invitable.map((m) => m.email), [invitable]);
  const [meetings, setMeetings] = useState<MeetingDTO[]>(initialMeetings);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [editor, setEditor] = useState<null | Editor>(null);
  // Members selectable as attendees for the meeting being edited (its project).
  const editorMembers = useMemo(() => (editor ? membersWithEmail(editor.forProject) : []), [editor, projects]);
  const [aiBusy, setAiBusy] = useState(false);
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

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
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

  const occurrences = useMemo(
    () => meetings.map((m) => occurrenceInWeek(m, weekStart)).filter((o): o is Occurrence => o !== null),
    [meetings, weekStart],
  );

  function openNew(day: Date, hour: number) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    setErr(null);
    setEditor({ id: null, title: "", start: toLocalInput(start), end: toLocalInput(end), notes: "", forProject: defaultProject, emailBody: "", kind: "plan", owners: [], color: accent, weekly: true, attendees: [] });
    setEmailInput("");
  }
  function openEdit(m: MeetingDTO) {
    setErr(null);
    setEmailInput("");
    setEditor({
      id: m.id,
      title: m.title,
      start: toLocalInput(new Date(m.startsAt)),
      end: toLocalInput(new Date(m.endsAt)),
      notes: m.notes ?? "",
      forProject: m.forProject ?? defaultProject,
      emailBody: m.emailBody ?? "",
      kind: m.kind,
      owners: m.owners ?? [],
      color: m.color ?? accent,
      weekly: m.weekly,
      attendees: m.attendees ?? [],
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
      when: new Date(editor.start).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }),
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
    if (!editor.title.trim()) { setErr("Dê um título à reunião."); return; }
    setSaving(true);
    setErr(null);
    const startsAt = new Date(editor.start).toISOString();
    const endsAt = new Date(editor.end).toISOString();
    const common = { title: editor.title, startsAt, endsAt, notes: editor.notes, forProject: editor.forProject, emailBody: editor.emailBody, kind: editor.kind, owners: editor.owners, color: editor.color, weekly: editor.weekly, attendees: editor.attendees };
    if (editor.id) {
      const r = await updateMeeting(editor.id, common, true);
      if (r.ok) {
        setMeetings((prev) => prev.map((m) => (m.id === r.meeting.id ? r.meeting : m)));
        setEditor(null);
        const notes = [r.inviteError && `convites: ${r.inviteError}`, r.calendarError && `Google: ${r.calendarError}`].filter(Boolean);
        if (notes.length) setToast(notes.join(" · "));
      } else setErr(r.error);
    } else {
      const r = await createMeeting(common);
      if (r.ok) {
        setMeetings((prev) => [...prev, r.meeting]);
        setEditor(null);
        const parts: string[] = ["Reunião criada"];
        if (editor.attendees.length) parts.push(r.inviteError ? `convites falharam (${r.inviteError})` : `${r.invited ?? 0} convite(s) enviado(s)`);
        if (r.calendarError) parts.push(`Google: ${r.calendarError}`);
        if (parts.length > 1) setToast(parts.join(" · "));
      } else setErr(r.error);
    }
    setSaving(false);
  }
  async function remove() {
    if (!editor?.id) return;
    setSaving(true);
    const r = await deleteMeeting(editor.id);
    if (r.ok) { setMeetings((prev) => prev.filter((m) => m.id !== editor.id)); setEditor(null); }
    else setErr(r.error);
    setSaving(false);
  }

  const weekLabel = `${days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${days[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-3 md:h-[calc(100dvh-4rem)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-foreground">Reuniões</h1>
          <p className="text-[11px] text-foreground-faint">Calendário semanal · clique num horário para marcar</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground">Hoje</button>
          <div className="flex items-center rounded-lg border border-border">
            <button type="button" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Semana anterior" className="px-2 py-1.5 text-foreground-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
            <span className="w-32 text-center text-xs font-medium text-foreground">{weekLabel}</span>
            <button type="button" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Próxima semana" className="px-2 py-1.5 text-foreground-muted hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="relative">
            <button type="button" onClick={() => setCalPanel((o) => !o)} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"><CalendarClock className="h-3.5 w-3.5" /> Disponibilidade{(() => { const n = teamAvail.filter((t) => t.status === "ok").length + calendars.length; return n ? ` (${n})` : ""; })()}{availBusy && <Loader2 className="h-3 w-3 animate-spin" />}</button>
            {calPanel && (
              <div className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-80 rounded-xl border border-border bg-surface-elevated p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Disponibilidade da equipe</span>
                  <label className="flex items-center gap-1 text-[10px] text-foreground-muted"><input type="checkbox" checked={showAvail} onChange={(e) => setShowAvail(e.target.checked)} /> mostrar</label>
                </div>

                {/* Team members (auto-loaded from the central roster) */}
                {invitable.length > 0 && (
                  <div className="mb-2 max-h-44 space-y-1 overflow-auto">
                    {invitable.map((m) => {
                      const st = teamAvail.find((t) => t.username === m.username);
                      const dot = st?.color ?? accent;
                      const label = !st ? (availBusy ? "verificando…" : "—") : st.status === "ok" ? "conectado" : st.status === "notShared" ? "não compartilhou" : "erro";
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
                {invitable.length === 0 && <p className="mb-2 text-[11px] text-foreground-faint">Nenhum membro com email. Cadastre o email da galera na aba <span className="text-foreground-muted">Team</span> que eles aparecem aqui.</p>}

                {/* Manually-added extra calendars (people outside the team / iCal feeds) */}
                {calendars.length > 0 && (
                  <div className="space-y-1.5 border-t border-border pt-2">
                    <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">Extras</span>
                    {calendars.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-xs">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? accent }} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                        <button type="button" onClick={() => removeCal(c.id)} className="text-foreground-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {serviceEmail ? (
                  <div className="mt-2 rounded-md border border-border bg-surface p-2 text-[10px] text-foreground-muted">
                    Pra um membro aparecer como <span className="text-success">conectado</span>, ele compartilha “Ver disponibilidade” do Google Calendar dele com:
                    <button type="button" onClick={() => navigator.clipboard?.writeText(serviceEmail)} title="Copiar" className="mt-1 block w-full truncate rounded bg-surface-elevated px-1.5 py-1 text-left font-mono text-[10px] text-accent hover:underline">{serviceEmail}</button>
                  </div>
                ) : null}
                {meetingsCal ? (
                  <div className="mt-2 rounded-md border border-border bg-surface p-2 text-[10px] text-foreground-muted">
                    As reuniões são criadas no calendário: <span className="font-mono text-foreground-subtle">{meetingsCal}</span>
                  </div>
                ) : null}
                <details className="mt-2 border-t border-border pt-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-foreground-subtle">+ Calendário extra (fora da equipe / iCal)</summary>
                  <div className="mt-1.5 space-y-1.5">
                    <input value={newCal.name} onChange={(e) => setNewCal({ ...newCal, name: e.target.value })} placeholder="Nome (pessoa)" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
                    <input value={newCal.icsUrl} onChange={(e) => setNewCal({ ...newCal, icsUrl: e.target.value })} placeholder="email@gmail.com ou https://…/basic.ics" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
                    <button type="button" onClick={addCal} className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90">Adicionar calendário</button>
                  </div>
                </details>
              </div>
            )}
          </div>
          <button type="button" onClick={() => openNew(today, Math.max(DAY_START, Math.min(DAY_END - 1, today.getHours())))} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Nova reunião</button>
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs text-accent">
          {toast}
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface">
        {/* Day header */}
        <div className="sticky top-0 z-10 grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border bg-surface">
          <div />
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div key={i} className={`border-l border-border px-1 py-1.5 text-center ${isToday ? "bg-accent-bg" : ""}`}>
                <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">{DAY_NAMES[i]}</div>
                <div className={`text-sm font-semibold ${isToday ? "text-accent" : "text-foreground"}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div className="grid grid-cols-[3rem_repeat(7,1fr)]">
          {/* hour gutter */}
          <div>
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_H }} className="relative border-b border-border/50">
                <span className="absolute -top-1.5 right-1 text-[10px] text-foreground-faint">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
          {/* day columns */}
          {days.map((day, di) => (
            <div key={di} className="relative border-l border-border">
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_H }}
                  onClick={() => openNew(day, h)}
                  className="border-b border-border/50 transition-colors hover:bg-accent-bg/40"
                />
              ))}
              {/* availability (busy) blocks behind meetings — no titles, just busy */}
              {showAvail && (busyByDay[di] ?? []).map((b, bi) => {
                const s = new Date(b.start);
                const e = new Date(b.end);
                const top = ((s.getHours() + s.getMinutes() / 60) - DAY_START) * HOUR_H;
                const height = Math.max(14, ((e.getTime() - s.getTime()) / 3600000) * HOUR_H);
                const c = b.color ?? accent;
                return (
                  <div
                    key={`busy-${bi}`}
                    title={b.title ? `${b.name}: ${b.title}` : `${b.name} · ocupado`}
                    style={{ top: Math.max(0, top), height, backgroundColor: `${c}1f`, borderColor: `${c}66` }}
                    className="pointer-events-none absolute left-1 right-[58%] z-0 overflow-hidden rounded-md border border-dashed px-1 text-[9px] leading-tight text-foreground-faint"
                  >
                    {b.title ? `${b.name}: ${b.title}` : b.name}
                  </div>
                );
              })}
              {/* events for this day */}
              {occurrences.filter((o) => o.dayIndex === di).map((o) => {
                const top = ((o.start.getHours() + o.start.getMinutes() / 60) - DAY_START) * HOUR_H;
                const height = Math.max(20, ((o.end.getTime() - o.start.getTime()) / 3600000) * HOUR_H);
                const c = o.meeting.color ?? accent;
                return (
                  <button
                    key={o.meeting.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEdit(o.meeting); }}
                    style={{ top: Math.max(0, top), height, backgroundColor: `${c}22`, borderColor: c }}
                    className="absolute left-[44%] right-1 z-10 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left hover:brightness-110"
                  >
                    <div className="flex items-center gap-1 truncate text-[11px] font-semibold text-foreground">
                      {o.meeting.weekly && <Repeat className="h-2.5 w-2.5 shrink-0 text-foreground-subtle" />}
                      <span className={`shrink-0 rounded px-1 text-[8px] font-bold uppercase ${o.meeting.kind === "exec" ? "bg-warning/20 text-warning" : "bg-foreground/10 text-foreground-subtle"}`}>{o.meeting.kind}</span>
                      {o.meeting.title}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      {o.start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      {o.meeting.kind === "exec" && o.meeting.owners.length > 0 && <span className="truncate text-accent">· {o.meeting.owners.length} dono(s)</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditor(null)}>
          <div className="max-h-[88vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">{editor.id ? "Editar reunião" : "Nova reunião"}</h2>
              <button type="button" onClick={() => setEditor(null)} className="text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <input
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              placeholder="Título da reunião"
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            {/* Project + type */}
            <div className="flex gap-2 text-xs">
              <label className="flex-1 text-foreground-muted">Projeto
                <select value={editor.forProject} onChange={(e) => setForProject(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-foreground">
                  {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex-1 text-foreground-muted">Tipo
                <select value={editor.kind} onChange={(e) => setEditor({ ...editor, kind: e.target.value as "plan" | "exec" })} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-foreground">
                  <option value="plan">[PLAN] Planejamento</option>
                  <option value="exec">[EXEC] Execução</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2 text-xs">
              <label className="flex-1 text-foreground-muted">Início
                <input type="datetime-local" value={editor.start} onChange={(e) => setEditor({ ...editor, start: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-foreground" />
              </label>
              <label className="flex-1 text-foreground-muted">Fim
                <input type="datetime-local" value={editor.end} onChange={(e) => setEditor({ ...editor, end: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-foreground" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground-muted">
              <input type="checkbox" checked={editor.weekly} onChange={(e) => setEditor({ ...editor, weekly: e.target.checked })} />
              <Repeat className="h-3.5 w-3.5" /> Repetir toda semana
            </label>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setEditor({ ...editor, color: c })} className={`h-5 w-5 rounded-full ${editor.color === c ? "ring-2 ring-offset-2 ring-offset-surface" : ""}`} style={{ backgroundColor: c, boxShadow: editor.color === c ? `0 0 0 2px ${c}` : undefined }} aria-label={`Cor ${c}`} />
              ))}
            </div>

            {/* Attendees — everyone's invited; EXEC meetings highlight owners (★) as responsible */}
            <div className="space-y-1.5">
              <span className="text-xs text-foreground-muted">
                Convidados · {projects.find((p) => p.slug === editor.forProject)?.name}
                {editor.kind === "exec" ? " — clique no ★ pra marcar o dono" : ""}
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
                          <button type="button" onClick={() => toggleOwner(m.email)} title={owner ? "Dono (responsável)" : "Marcar como dono"} className="leading-none">{owner ? "★" : "☆"}</button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-foreground-faint">Esse projeto não tem membros com email — cadastre na aba Team, ou digite abaixo.</p>
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
                  placeholder="email@exemplo.com"
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
                />
                <button type="button" onClick={() => { if (/@/.test(emailInput)) { toggleAttendee(emailInput); setEmailInput(""); } }} className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted hover:text-foreground">Add</button>
              </div>
            </div>

            {/* Pauta + Improve with AI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground-muted">Pauta</span>
                <ImproveAiButton busy={aiBusy} defaultInstruction={MEETING_AI_INSTRUCTION} onRun={(instr) => improveWithAI(instr)} />
              </div>
              <textarea
                value={editor.notes}
                onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                rows={3}
                placeholder="Pauta / o que será discutido"
                className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
              />
            </div>

            {/* Invite email (AI-fillable, editable) */}
            <details className="rounded-lg border border-border bg-surface-elevated p-2" open={!!editor.emailBody}>
              <summary className="cursor-pointer text-xs text-foreground-muted">Email do convite {editor.emailBody ? "(personalizado)" : "(padrão)"}</summary>
              <textarea
                value={editor.emailBody}
                onChange={(e) => setEditor({ ...editor, emailBody: e.target.value })}
                rows={4}
                placeholder="Vazio = email padrão. Use o Improve with AI pra gerar."
                className="mt-1.5 w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
              />
            </details>
            {err && <p className="text-xs text-danger">{err}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={save} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar
              </button>
              {editor.id && (
                <button type="button" onClick={remove} disabled={saving} className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-50">
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
