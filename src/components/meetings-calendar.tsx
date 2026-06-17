"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Repeat, Loader2 } from "lucide-react";
import { createMeeting, updateMeeting, deleteMeeting, type MeetingDTO } from "@/app/actions/meetings";

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

export function MeetingsCalendar({ initialMeetings, accent }: { initialMeetings: MeetingDTO[]; accent: string }) {
  const [meetings, setMeetings] = useState<MeetingDTO[]>(initialMeetings);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [editor, setEditor] = useState<null | { id: string | null; title: string; start: string; end: string; notes: string; color: string; weekly: boolean }>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();

  const occurrences = useMemo(
    () => meetings.map((m) => occurrenceInWeek(m, weekStart)).filter((o): o is Occurrence => o !== null),
    [meetings, weekStart],
  );

  function openNew(day: Date, hour: number) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    setErr(null);
    setEditor({ id: null, title: "", start: toLocalInput(start), end: toLocalInput(end), notes: "", color: accent, weekly: true });
  }
  function openEdit(m: MeetingDTO) {
    setErr(null);
    setEditor({
      id: m.id,
      title: m.title,
      start: toLocalInput(new Date(m.startsAt)),
      end: toLocalInput(new Date(m.endsAt)),
      notes: m.notes ?? "",
      color: m.color ?? accent,
      weekly: m.weekly,
    });
  }

  async function save() {
    if (!editor) return;
    if (!editor.title.trim()) { setErr("Dê um título à reunião."); return; }
    setSaving(true);
    setErr(null);
    const startsAt = new Date(editor.start).toISOString();
    const endsAt = new Date(editor.end).toISOString();
    if (editor.id) {
      const r = await updateMeeting(editor.id, { title: editor.title, startsAt, endsAt, notes: editor.notes, color: editor.color, weekly: editor.weekly });
      if (r.ok) { setMeetings((prev) => prev.map((m) => (m.id === r.meeting.id ? r.meeting : m))); setEditor(null); }
      else setErr(r.error);
    } else {
      const r = await createMeeting({ title: editor.title, startsAt, endsAt, notes: editor.notes, color: editor.color, weekly: editor.weekly });
      if (r.ok) { setMeetings((prev) => [...prev, r.meeting]); setEditor(null); }
      else setErr(r.error);
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
          <button type="button" onClick={() => openNew(today, Math.max(DAY_START, Math.min(DAY_END - 1, today.getHours())))} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Nova reunião</button>
        </div>
      </div>

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
                    className="absolute inset-x-1 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left hover:brightness-110"
                  >
                    <div className="flex items-center gap-1 truncate text-[11px] font-semibold text-foreground">
                      {o.meeting.weekly && <Repeat className="h-2.5 w-2.5 shrink-0 text-foreground-subtle" />}
                      {o.meeting.title}
                    </div>
                    <div className="text-[10px] text-foreground-muted">
                      {o.start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
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
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
            <textarea
              value={editor.notes}
              onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
              rows={3}
              placeholder="Notas / pauta (opcional)"
              className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
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
