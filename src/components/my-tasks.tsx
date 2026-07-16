"use client";

import { useRouter } from "next/navigation";
import type { MemberTask } from "@/app/actions/team-admin";
import { FirePriority, DeadlineChip } from "@/components/card-indicators";

// Mirrors the Kanban card look (labels · title · status/#/🔥/deadline footer)
// so a member's tasks read as the same object they see on the board.
export function MyTasks({
  tasks,
  username,
}: {
  tasks: MemberTask[];
  username: string;
}) {
  const router = useRouter();
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
            onClick={() => router.push(`/kanban?open=${encodeURIComponent(t.id)}`)}
            className="group flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-elevated"
            title="Abrir card no Kanban"
          >
            {t.labels && t.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.labels.slice(0, 3).map((label) => (
                  <span
                    key={label.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium leading-tight text-foreground-muted"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} />
                    {label.name}
                  </span>
                ))}
              </div>
            )}

            <p className="line-clamp-2 text-sm text-foreground">{t.title}</p>

            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
              <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">
                {t.status}
              </span>
              {t.number != null && (
                <span className="font-mono tabular-nums text-[11px] text-foreground-subtle">#{t.number}</span>
              )}
              <FirePriority value={t.firePriority} />
              <DeadlineChip value={t.deadline} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
