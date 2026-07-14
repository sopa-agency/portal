"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, KanbanSquare, Plus, Trash2, ExternalLink, Check, Pencil, Eye, RefreshCw, CalendarDays } from "lucide-react";
import type { MeetingDTO } from "@/app/actions/meetings";
import {
  listOccurrences,
  ensureOccurrence,
  getOccurrence,
  saveOccurrence,
  extractOccurrenceActions,
  createCardsFromOccurrence,
  publishOccurrenceToHackmd,
  reconcileOccurrences,
} from "@/app/actions/meeting-occurrences";
import type { MeetingActionItem, OccurrenceDTO } from "@/lib/meeting-actions";
import { MarkdownContent } from "@/components/markdown-content";

type ProjectOption = { slug: string; name: string; members: { username: string }[] };
type OccMeta = { id: string; occurredOn: string; hasAta: boolean; actionCount: number; hackmdUrl: string | null };

let localSeq = 0;
function newItem(): MeetingActionItem {
  return { id: `new_${localSeq++}`, text: "", project: "", owner: null, priority: 0, deadline: null, done: false, cardItemId: null, cardUrl: null };
}
const FIRE = [1, 2, 3, 4, 5];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const toYmd = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Most recent occurrence date for a weekly series (snapped to its weekday/time), else the meeting date. */
function defaultOccurrenceISO(meeting: MeetingDTO): string {
  const s = new Date(meeting.startsAt);
  if (!meeting.weekly) return meeting.startsAt;
  const now = new Date();
  const diff = (now.getDay() - s.getDay() + 7) % 7;
  const target = new Date(now);
  target.setDate(now.getDate() - diff);
  target.setHours(s.getHours(), s.getMinutes(), 0, 0);
  return target.toISOString();
}

/**
 * Per-meeting ata workspace. Weekly meetings have many dated occurrences; this
 * lets you pick a week (or create one), then edit that occurrence's ata + actions.
 */
export function MeetingAtaPanel({ meeting, projects }: { meeting: MeetingDTO; projects: ProjectOption[]; onUpdated?: (m: MeetingDTO) => void }) {
  const [occs, setOccs] = useState<OccMeta[]>([]);
  const [selected, setSelected] = useState<OccurrenceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [newDate, setNewDate] = useState(toYmd(defaultOccurrenceISO(meeting)));
  const [busy, setBusy] = useState<null | "load" | "reconcile" | "create">(null);
  const [err, setErr] = useState<string | null>(null);

  async function refreshList(selectId?: string) {
    const r = await listOccurrences(meeting.id);
    if (!r.ok) { setErr(r.error); setLoading(false); return; }
    setOccs(r.occurrences);
    const pick = selectId ?? selected?.id ?? r.occurrences[0]?.id;
    if (pick) {
      const g = await getOccurrence(pick);
      if (g.ok) setSelected(g.occurrence);
    } else {
      setSelected(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  async function select(id: string) {
    const g = await getOccurrence(id);
    if (g.ok) setSelected(g.occurrence);
    else setErr(g.error);
  }

  async function createForDate() {
    setBusy("create"); setErr(null);
    // Preserve the meeting's time-of-day on the chosen date.
    const s = new Date(meeting.startsAt);
    const d = new Date(`${newDate}T00:00:00`);
    d.setHours(s.getHours(), s.getMinutes(), 0, 0);
    const r = await ensureOccurrence(meeting.id, d.toISOString());
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    await refreshList(r.occurrence.id);
  }

  async function runReconcile() {
    setBusy("reconcile"); setErr(null);
    const r = await reconcileOccurrences(meeting.id);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    await refreshList();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Ata & ações {meeting.weekly ? "· por semana" : ""}</span>
        <button type="button" onClick={runReconcile} disabled={busy !== null} className="flex items-center gap-1 text-[11px] text-foreground-muted hover:text-foreground disabled:opacity-40" title="Buscar atas no HackMD e vincular às semanas">
          {busy === "reconcile" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} reconciliar
        </button>
      </div>

      {/* Occurrence selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        {occs.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => select(o.id)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${selected?.id === o.id ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}
          >
            <CalendarDays className="h-3 w-3" /> {fmtDate(o.occurredOn)}
            {o.hasAta ? <Check className="h-3 w-3 text-success" /> : null}
            {o.actionCount ? <span className="text-foreground-faint">· {o.actionCount}</span> : null}
          </button>
        ))}
        <span className="flex items-center gap-1">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="rounded border border-border bg-surface px-1 py-0.5 text-[10px] text-foreground" />
          <button type="button" onClick={createForDate} disabled={busy !== null} className="flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-40">
            {busy === "create" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} ocorrência
          </button>
        </span>
      </div>

      {err && <p className="text-[11px] text-danger">{err}</p>}
      {loading ? (
        <p className="py-4 text-center text-[11px] text-foreground-faint"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p>
      ) : selected ? (
        <OccurrenceEditor key={selected.id} occurrence={selected} projects={projects} onChanged={(o) => { setSelected(o); refreshList(o.id); }} />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-foreground-faint">
          Nenhuma ocorrência ainda. Escolha uma data e clique <span className="text-foreground-muted">＋ ocorrência</span>, ou <span className="text-foreground-muted">reconciliar</span> pra puxar do HackMD.
        </p>
      )}
    </div>
  );
}

/** The ata + action-items editor for a single occurrence. Keyed by occurrence id
 *  so switching weeks remounts it with fresh state (no cross-week bleed). */
function OccurrenceEditor({ occurrence, projects, onChanged }: { occurrence: OccurrenceDTO; projects: ProjectOption[]; onChanged: (o: OccurrenceDTO) => void }) {
  const [transcript, setTranscript] = useState(occurrence.transcript ?? "");
  const [summary, setSummary] = useState(occurrence.summary ?? "");
  const [items, setItems] = useState<MeetingActionItem[]>(occurrence.actionItems);
  const [busy, setBusy] = useState<null | "extract" | "save" | "cards" | "hackmd">(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);

  const usernames = useMemo(() => {
    const s = new Set<string>();
    for (const p of projects) for (const m of p.members) s.add(m.username);
    return [...s].sort();
  }, [projects]);

  const dirty =
    summary !== (occurrence.summary ?? "") ||
    transcript !== (occurrence.transcript ?? "") ||
    JSON.stringify(items) !== JSON.stringify(occurrence.actionItems);
  const pendingCards = items.filter((it) => !it.cardItemId && it.project && it.text.trim()).length;
  const projName = (slug: string) => projects.find((p) => p.slug === slug)?.name ?? slug;
  const patchItem = (id: string, patch: Partial<MeetingActionItem>) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  async function runExtract() {
    setBusy("extract"); setErr(null); setNote(null);
    const r = await extractOccurrenceActions(occurrence.id, { source: transcript.trim() || undefined });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setSummary(r.occurrence.summary ?? ""); setItems(r.occurrence.actionItems); setTranscript(r.occurrence.transcript ?? transcript);
    onChanged(r.occurrence);
    setNote(`${r.occurrence.actionItems.length} ação(ões) extraída(s).`);
  }
  async function runSave() {
    setBusy("save"); setErr(null); setNote(null);
    const r = await saveOccurrence(occurrence.id, { summary, transcript, actionItems: items });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setItems(r.occurrence.actionItems); onChanged(r.occurrence); setNote("Salvo.");
  }
  async function runCards() {
    if (dirty) {
      const s = await saveOccurrence(occurrence.id, { summary, transcript, actionItems: items });
      if (!s.ok) { setErr(s.error); return; }
    }
    setBusy("cards"); setErr(null); setNote(null);
    const r = await createCardsFromOccurrence(occurrence.id);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setItems(r.occurrence.actionItems); onChanged(r.occurrence);
    const failed = r.results.filter((x) => !x.ok);
    setNote(`${r.created} card(s) criado(s).` + (failed.length ? ` ${failed.length} pulado(s): ${[...new Set(failed.map((f) => `${f.project || "?"} (${f.error})`))].join(", ")}` : ""));
  }
  async function runHackmd() {
    if (dirty) { const s = await saveOccurrence(occurrence.id, { summary, transcript, actionItems: items }); if (!s.ok) { setErr(s.error); return; } }
    setBusy("hackmd"); setErr(null); setNote(null);
    const r = await publishOccurrenceToHackmd(occurrence.id);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    onChanged(r.occurrence);
    setNote(`Publicado no HackMD · ${r.calendar}.`);
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {occurrence.hackmdUrl && (
        <a href={occurrence.hackmdUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
          <ExternalLink className="h-3 w-3" /> Ata no HackMD
        </a>
      )}

      <details className="rounded-md border border-border bg-surface p-2" open={!summary}>
        <summary className="cursor-pointer text-[11px] text-foreground-muted">Transcrição / texto-fonte {transcript ? `(${transcript.length} chars)` : "(vazio)"}</summary>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} placeholder="Cole a transcrição desta reunião. A IA extrai o resumo + as ações." className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
      </details>

      <button type="button" onClick={runExtract} disabled={busy !== null} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
        {busy === "extract" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Extrair ata + ações com IA
      </button>

      {(summary || items.length > 0) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-foreground-muted">Resumo (ata)</span>
            <button type="button" onClick={() => setEditingSummary((v) => !v)} className="flex items-center gap-1 text-[11px] text-foreground-muted hover:text-foreground">
              {editingSummary ? <><Eye className="h-3 w-3" /> ver</> : <><Pencil className="h-3 w-3" /> editar</>}
            </button>
          </div>
          {editingSummary ? (
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={14} placeholder="Resumo em markdown" className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
          ) : summary ? (
            <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border bg-surface px-4 py-3"><MarkdownContent markdown={summary} /></div>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-foreground-faint">Sem resumo ainda — extraia com a IA.</p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-foreground-muted">Ações ({items.length})</span>
          <button type="button" onClick={() => setItems((p) => [...p, newItem()])} className="flex items-center gap-1 text-[11px] text-foreground-muted hover:text-foreground"><Plus className="h-3 w-3" /> add</button>
        </div>
        {items.map((it) => (
          <div key={it.id} className={`rounded-md border p-2 ${it.cardItemId ? "border-success/40 bg-success/5" : "border-border bg-surface"}`}>
            <div className="flex items-start gap-1.5">
              <button type="button" onClick={() => patchItem(it.id, { done: !it.done })} title={it.done ? "Feito" : "Marcar como feito"} className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${it.done ? "border-success bg-success text-white" : "border-border text-transparent hover:border-border-strong"}`}><Check className="h-3 w-3" /></button>
              <textarea value={it.text} onChange={(e) => patchItem(it.id, { text: e.target.value })} rows={1} placeholder="Ação…" className={`min-w-0 flex-1 resize-y rounded border border-border bg-surface-elevated px-1.5 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none ${it.done ? "line-through opacity-60" : ""}`} />
              <button type="button" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="mt-0.5 shrink-0 text-foreground-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
              <select value={it.project} onChange={(e) => patchItem(it.id, { project: e.target.value })} className="rounded border border-border bg-surface-elevated px-1 py-0.5 text-[10px] text-foreground">
                <option value="">— projeto —</option>
                {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
              <select value={it.owner ?? ""} onChange={(e) => patchItem(it.id, { owner: e.target.value || null })} className="rounded border border-border bg-surface-elevated px-1 py-0.5 text-[10px] text-foreground">
                <option value="">— dono —</option>
                {usernames.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <div className="flex items-center gap-0.5">
                {FIRE.map((n) => (<button key={n} type="button" onClick={() => patchItem(it.id, { priority: it.priority === n ? 0 : n })} title={`🔥${n}`} className={`text-[10px] ${it.priority >= n ? "opacity-100" : "opacity-25 grayscale"}`}>🔥</button>))}
              </div>
              <input type="date" value={it.deadline ?? ""} onChange={(e) => patchItem(it.id, { deadline: e.target.value || null })} className="rounded border border-border bg-surface-elevated px-1 py-0.5 text-[10px] text-foreground" />
              {it.cardItemId ? (
                it.cardUrl ? <a href={it.cardUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-success hover:underline"><KanbanSquare className="h-3 w-3" /> card</a>
                : <span className="flex items-center gap-0.5 text-[10px] text-success" title={`card em ${projName(it.project)}`}><KanbanSquare className="h-3 w-3" /> card ✓</span>
              ) : null}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-[10px] text-foreground-faint">Nenhuma ação ainda — extraia com a IA ou adicione manualmente.</p>}
      </div>

      {err && <p className="text-[11px] text-danger">{err}</p>}
      {note && <p className="text-[11px] text-success">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runSave} disabled={busy !== null || !dirty} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40">
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Salvar
        </button>
        <button type="button" onClick={runCards} disabled={busy !== null || pendingCards === 0} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40">
          {busy === "cards" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KanbanSquare className="h-3.5 w-3.5" />} Criar {pendingCards || ""} card(s)
        </button>
        <button type="button" onClick={runHackmd} disabled={busy !== null || !summary} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40">
          {busy === "hackmd" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} {occurrence.hackmdUrl ? "Atualizar HackMD" : "Publicar no HackMD"}
        </button>
      </div>
    </div>
  );
}
