"use client";

import { useRouter } from "next/navigation";
import type { MemberTask } from "@/app/actions/team-admin";

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
            className="group flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-elevated"
            title="Abrir card no Kanban"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{t.status}</span>
              {t.number ? <span className="text-[10px] text-foreground-faint">#{t.number}</span> : null}
            </div>
            <p className="line-clamp-2 text-sm text-foreground">{t.title}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
