"use client";

import { useState } from "react";
import { Loader2, Mail, X, ExternalLink } from "lucide-react";
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
            title="Ver detalhes da tarefa"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{t.status}</span>
              {t.number ? <span className="text-[10px] text-foreground-faint">#{t.number}</span> : null}
            </div>
            <p className="line-clamp-2 text-sm text-foreground">{t.title}</p>
          </button>
        ))}
      </div>
      {active && <TaskDetailsDialog task={active} userEmail={userEmail} onClose={() => setActive(null)} />}
    </section>
  );
}

function TaskDetailsDialog({ task, userEmail, onClose }: { task: MemberTask; userEmail: string | null; onClose: () => void }) {
  const [reminding, setReminding] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-muted">{task.status}</span>
              {task.number ? <span className="text-xs text-foreground-faint">#{task.number}</span> : null}
            </div>
            <h3 className="text-base font-bold text-foreground">{task.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {task.labels && task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.labels.map((l) => (
              <span key={l.name} className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: `#${l.color}22`, color: `#${l.color}` }}>{l.name}</span>
            ))}
          </div>
        )}

        {task.assignees && task.assignees.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Responsáveis</span>
            <span className="flex -space-x-1.5">
              {task.assignees.map((a) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} className="h-5 w-5 rounded-full border border-surface object-cover" />
              ))}
            </span>
          </div>
        )}

        {task.body ? (
          <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-elevated p-3 text-sm text-foreground-muted">{task.body}</div>
        ) : (
          <p className="text-xs text-foreground-faint">Sem descrição.</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {task.url && (
            <a href={task.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-border-strong hover:text-foreground">
              <ExternalLink className="h-4 w-4" /> Abrir no GitHub
            </a>
          )}
          <button type="button" onClick={() => setReminding((r) => !r)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-border-strong hover:text-foreground">
            <Mail className="h-4 w-4" /> Enviar lembrete
          </button>
        </div>

        {reminding && <ReminderForm task={task} defaultTo={userEmail} />}
      </div>
    </div>
  );
}

function ReminderForm({ task, defaultTo }: { task: MemberTask; defaultTo: string | null }) {
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
    <div className="space-y-2 rounded-lg border border-border bg-surface-elevated p-3">
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="para@email.com" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none" />
      {result && <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>}
      <button type="button" onClick={send} disabled={sending || !to.trim()} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Enviar lembrete
      </button>
    </div>
  );
}
