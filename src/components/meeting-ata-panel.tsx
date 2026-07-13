"use client";

import { useMemo, useState } from "react";
import { Loader2, Sparkles, KanbanSquare, Plus, Trash2, ExternalLink, Check } from "lucide-react";
import {
  extractMeetingActions,
  saveMeetingSummary,
  createCardsFromMeeting,
  publishMeetingToHackmd,
  type MeetingDTO,
} from "@/app/actions/meetings";
import type { MeetingActionItem } from "@/lib/meeting-actions";

type ProjectOption = { slug: string; name: string; members: { username: string }[] };

// Deterministic local id for a freshly-added row (no Math.random — avoids SSR/CSR
// mismatch and keeps keys stable across re-renders within a session).
let localSeq = 0;
function newItem(): MeetingActionItem {
  return { id: `new_${localSeq++}`, text: "", project: "", owner: null, priority: 0, deadline: null, done: false, cardItemId: null, cardUrl: null };
}

const FIRE = [1, 2, 3, 4, 5];

/**
 * Post-meeting workspace shown inside the meeting editor: paste transcript →
 * extract summary + action items with the agent → tune them → one-click into
 * Kanban cards → publish the ata to HackMD. Every server round-trip returns the
 * updated meeting so the parent list stays in sync.
 */
export function MeetingAtaPanel({
  meeting,
  projects,
  onUpdated,
}: {
  meeting: MeetingDTO;
  projects: ProjectOption[];
  onUpdated: (m: MeetingDTO) => void;
}) {
  const [transcript, setTranscript] = useState(meeting.transcript ?? "");
  const [summary, setSummary] = useState(meeting.summary ?? "");
  const [items, setItems] = useState<MeetingActionItem[]>(meeting.actionItems);
  const [busy, setBusy] = useState<null | "extract" | "save" | "cards" | "hackmd">(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Union of every project's members → owner dropdown.
  const usernames = useMemo(() => {
    const s = new Set<string>();
    for (const p of projects) for (const m of p.members) s.add(m.username);
    return [...s].sort();
  }, [projects]);

  const dirty =
    summary !== (meeting.summary ?? "") ||
    transcript !== (meeting.transcript ?? "") ||
    JSON.stringify(items) !== JSON.stringify(meeting.actionItems);
  const pendingCards = items.filter((it) => !it.cardItemId && it.project && it.text.trim()).length;

  function patchItem(id: string, patch: Partial<MeetingActionItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function runExtract() {
    setBusy("extract"); setErr(null); setNote(null);
    const r = await extractMeetingActions(meeting.id, { source: transcript.trim() || undefined });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setSummary(r.meeting.summary ?? "");
    setItems(r.meeting.actionItems);
    setTranscript(r.meeting.transcript ?? transcript);
    onUpdated(r.meeting);
    setNote(`${r.meeting.actionItems.length} ação(ões) extraída(s).`);
  }

  async function runSave() {
    setBusy("save"); setErr(null); setNote(null);
    const r = await saveMeetingSummary(meeting.id, { summary, transcript, actionItems: items });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setItems(r.meeting.actionItems);
    onUpdated(r.meeting);
    setNote("Salvo.");
  }

  async function runCards() {
    // Persist any pending edits first so the server cards the current state.
    if (dirty) {
      const s = await saveMeetingSummary(meeting.id, { summary, transcript, actionItems: items });
      if (!s.ok) { setErr(s.error); return; }
      onUpdated(s.meeting);
    }
    setBusy("cards"); setErr(null); setNote(null);
    const r = await createCardsFromMeeting(meeting.id);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    // Reflect the new cardItemIds by reloading from the meeting the action returns via onUpdated.
    const failed = r.results.filter((x) => !x.ok);
    setNote(
      `${r.created} card(s) criado(s).` +
        (failed.length ? ` ${failed.length} pulado(s): ${[...new Set(failed.map((f) => `${f.project || "?"} (${f.error})`))].join(", ")}` : ""),
    );
    // Re-fetch the meeting's items: saveMeetingSummary/createCards mutate DB; pull fresh via a no-op save.
    const fresh = await saveMeetingSummary(meeting.id, {});
    if (fresh.ok) { setItems(fresh.meeting.actionItems); onUpdated(fresh.meeting); }
  }

  async function runHackmd() {
    setBusy("hackmd"); setErr(null); setNote(null);
    const r = await publishMeetingToHackmd(meeting.id);
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    onUpdated(r.meeting);
    setNote("Publicado no HackMD.");
  }

  const projName = (slug: string) => projects.find((p) => p.slug === slug)?.name ?? slug;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Ata & ações</span>
        {meeting.summaryUrl && (
          <a href={meeting.summaryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
            <ExternalLink className="h-3 w-3" /> HackMD
          </a>
        )}
      </div>

      {/* Transcript → extract */}
      <details className="rounded-md border border-border bg-surface p-2" open={!summary}>
        <summary className="cursor-pointer text-[11px] text-foreground-muted">Transcrição / texto-fonte {transcript ? `(${transcript.length} chars)` : "(vazio)"}</summary>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={4}
          placeholder="Cole aqui a transcrição da reunião (ou a ata bruta). A IA extrai o resumo + as ações."
          className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
      </details>

      <button
        type="button"
        onClick={runExtract}
        disabled={busy !== null}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
      >
        {busy === "extract" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Extrair ata + ações com IA
      </button>

      {/* Summary */}
      {(summary || items.length > 0) && (
        <div className="space-y-1">
          <span className="text-[11px] text-foreground-muted">Resumo (ata)</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            placeholder="Resumo em markdown"
            className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
          />
        </div>
      )}

      {/* Action items */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-foreground-muted">Ações ({items.length})</span>
          <button type="button" onClick={() => setItems((p) => [...p, newItem()])} className="flex items-center gap-1 text-[11px] text-foreground-muted hover:text-foreground">
            <Plus className="h-3 w-3" /> add
          </button>
        </div>
        {items.map((it) => (
          <div key={it.id} className={`rounded-md border p-2 ${it.cardItemId ? "border-success/40 bg-success/5" : "border-border bg-surface"}`}>
            <div className="flex items-start gap-1.5">
              <button
                type="button"
                onClick={() => patchItem(it.id, { done: !it.done })}
                title={it.done ? "Feito" : "Marcar como feito"}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${it.done ? "border-success bg-success text-white" : "border-border text-transparent hover:border-border-strong"}`}
              >
                <Check className="h-3 w-3" />
              </button>
              <textarea
                value={it.text}
                onChange={(e) => patchItem(it.id, { text: e.target.value })}
                rows={1}
                placeholder="Ação…"
                className={`min-w-0 flex-1 resize-y rounded border border-border bg-surface-elevated px-1.5 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none ${it.done ? "line-through opacity-60" : ""}`}
              />
              <button type="button" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="mt-0.5 shrink-0 text-foreground-faint hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
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
                {FIRE.map((n) => (
                  <button key={n} type="button" onClick={() => patchItem(it.id, { priority: it.priority === n ? 0 : n })} title={`🔥${n}`} className={`text-[10px] ${it.priority >= n ? "opacity-100" : "opacity-25 grayscale"}`}>🔥</button>
                ))}
              </div>
              <input type="date" value={it.deadline ?? ""} onChange={(e) => patchItem(it.id, { deadline: e.target.value || null })} className="rounded border border-border bg-surface-elevated px-1 py-0.5 text-[10px] text-foreground" />
              {it.cardItemId ? (
                it.cardUrl ? (
                  <a href={it.cardUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-success hover:underline"><KanbanSquare className="h-3 w-3" /> card</a>
                ) : (
                  <span className="flex items-center gap-0.5 text-[10px] text-success" title={`card em ${projName(it.project)}`}><KanbanSquare className="h-3 w-3" /> card ✓</span>
                )
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
          {busy === "hackmd" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} {meeting.summaryUrl ? "Atualizar HackMD" : "Publicar no HackMD"}
        </button>
      </div>
    </div>
  );
}
