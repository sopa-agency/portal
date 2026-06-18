"use client";

import { useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { sendTaskReminder } from "@/app/actions/task-reminder";
import type { MemberTask } from "@/app/actions/team-admin";

export function MyTasks({
  tasks,
  username,
  userEmail,
}: {
  tasks: MemberTask[];
  username: string;
  userEmail: string | null;
}) {
  const [active, setActive] = useState<MemberTask | null>(null);
  if (tasks.length === 0) return null;

  return (
    <section aria-labelledby="my-tasks-heading" className="space-y-3">
      <h2 id="my-tasks-heading" className="text-lg font-semibold tracking-tight text-foreground">
        Minhas tarefas <span className="text-xs font-normal text-foreground-faint">@{username} · {tasks.length} no Kanban</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(t)}
            className="group flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-elevated"
            title="Enviar email lembrete desta tarefa"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{t.status}</span>
              {t.number ? <span className="text-[10px] text-foreground-faint">#{t.number}</span> : null}
            </div>
            <p className="line-clamp-2 text-sm text-foreground">{t.title}</p>
            <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-accent opacity-0 transition-opacity group-hover:opacity-100">
              <Mail className="h-3 w-3" /> enviar lembrete
            </span>
          </button>
        ))}
      </div>
      {active && <ReminderDialog task={active} defaultTo={userEmail} onClose={() => setActive(null)} />}
    </section>
  );
}

function ReminderDialog({ task, defaultTo, onClose }: { task: MemberTask; defaultTo: string | null; onClose: () => void }) {
  const [to, setTo] = useState(defaultTo ?? "");
  const [subject, setSubject] = useState(`Lembrete: ${task.title}`);
  const [body, setBody] = useState(
    `Lembrete da tarefa "${task.title}"${task.number ? ` (#${task.number})` : ""}.\nStatus: ${task.status}${task.url ? `\n\n${task.url}` : ""}`,
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setSending(true);
    setResult(null);
    const r = await sendTaskReminder({ to, subject, body });
    setSending(false);
    setResult(r.ok ? { ok: true, text: "Lembrete enviado ✅" } : { ok: false, text: r.error });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground"><Mail className="h-4 w-4 text-accent" /> Email lembrete</h3>
          <button type="button" onClick={onClose} className="text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <label className="block text-xs text-foreground-muted">Para
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@exemplo.com" className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none" />
        </label>
        <label className="block text-xs text-foreground-muted">Assunto
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none" />
        </label>
        <label className="block text-xs text-foreground-muted">Mensagem
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="mt-1 w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none" />
        </label>
        {result && <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>}
        <button
          type="button"
          onClick={send}
          disabled={sending || !to.trim()}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Enviar lembrete
        </button>
      </div>
    </div>
  );
}
