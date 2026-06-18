"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, X, CalendarPlus } from "lucide-react";
import type { AggregatedColumn, AggregatedItem } from "@/lib/github-project";

// Read-only aggregated board for the SOPA hub: every portal's Kanban merged by
// status. Cards open a details dialog; from there you can create an EXEC meeting
// pre-filled with the task + its assignees.
export function AggregatedKanban({ columns }: { columns: AggregatedColumn[] }) {
  const [active, setActive] = useState<AggregatedItem | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const total = columns.reduce((n, c) => n + c.items.length, 0);
  if (total === 0) {
    return <p className="text-sm text-foreground-muted">Nenhuma tarefa nos boards (ou tokens do GitHub indisponíveis).</p>;
  }
  const boards = [...new Set(columns.flatMap((c) => c.items.map((i) => i.board)))].sort();
  const match = (it: AggregatedItem) => !board || it.board === board;
  const visible = columns.map((c) => ({ ...c, items: c.items.filter(match) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Project filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Projeto:</span>
        <button type="button" onClick={() => setBoard(null)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${board === null ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
          Todos <span className="text-foreground-faint">({total})</span>
        </button>
        {boards.map((b) => {
          const n = columns.reduce((s, c) => s + c.items.filter((i) => i.board === b).length, 0);
          return (
            <button key={b} type="button" onClick={() => setBoard(b)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${board === b ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
              {b} <span className="text-foreground-faint">({n})</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {visible.map((col) => (
        <section key={col.name} className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface">
          <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <span className="truncate text-sm font-semibold text-foreground">{col.name}</span>
            <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 text-[10px] text-foreground-muted">{col.items.length}</span>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {col.items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setActive(it)}
                className="block w-full rounded-lg border border-border bg-surface-elevated p-2.5 text-left transition-colors hover:border-border-strong"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">{it.board}</span>
                  {it.number ? <span className="text-[10px] text-foreground-faint">#{it.number}</span> : null}
                </div>
                <p className="line-clamp-3 text-sm text-foreground">{it.title}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {it.labels.slice(0, 3).map((l) => (
                    <span key={l.name} className="rounded px-1 text-[9px]" style={{ backgroundColor: `#${l.color}22`, color: `#${l.color}` }}>{l.name}</span>
                  ))}
                  <span className="ml-auto flex -space-x-1.5">
                    {it.assignees.slice(0, 4).map((a) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} className="h-4 w-4 rounded-full border border-surface object-cover" />
                    ))}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
      </div>
      {active && <TaskDialog item={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function TaskDialog({ item, onClose }: { item: AggregatedItem; onClose: () => void }) {
  const router = useRouter();

  function createExecMeeting() {
    const prefill = {
      title: item.title,
      forProject: item.projectSlug,
      kind: "exec" as const,
      notes: item.body ?? "",
      logins: item.assignees.map((a) => a.login),
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(prefill))));
    router.push(`/reunioes?new=${encodeURIComponent(b64)}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">{item.board}</span>
              {item.number ? <span className="text-xs text-foreground-faint">#{item.number}</span> : null}
            </div>
            <h3 className="text-base font-bold text-foreground">{item.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {item.assignees.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Responsáveis</span>
            <span className="flex flex-wrap items-center gap-1">
              {item.assignees.map((a) => (
                <span key={a.login} className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.avatarUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                  {a.login}
                </span>
              ))}
            </span>
          </div>
        )}

        {item.body ? (
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-elevated p-3 text-sm text-foreground-muted">{item.body}</div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={createExecMeeting} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90">
            <CalendarPlus className="h-4 w-4" /> Criar reunião EXEC
          </button>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-border-strong hover:text-foreground">
              <ExternalLink className="h-4 w-4" /> Abrir no GitHub
            </a>
          )}
        </div>
        <p className="text-[11px] text-foreground-faint">A reunião EXEC abre já com o título, o projeto, a pauta e os responsáveis — você confirma data e horário.</p>
      </div>
    </div>
  );
}
