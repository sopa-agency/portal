"use client";

import { useSyncExternalStore, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { MemberTask } from "@/app/actions/team-admin";
import { FirePriority, DeadlineChip } from "@/components/card-indicators";
import { useT } from "@/components/locale-provider";

// Mirrors the Kanban card look (labels · title · status/#/🔥/deadline footer)
// so a member's tasks read as the same object they see on the board.
//
// Collapsed by default: 25 cards between the header and the briefing turn the
// morning read into a scroll. The summary line carries what actually urges —
// overdue and due-today — so the section is worth glancing at while shut, and
// the choice is remembered.

const OPEN_KEY = "portal:home:my-tasks-open";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("my-tasks-toggle", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("my-tasks-toggle", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shut on the server, so the first paint never flashes 25 cards open. */
function getServerSnapshot(): boolean {
  return false;
}

/** yyyy-mm-dd compares correctly as a string, so no Date parsing (and no
 *  timezone surprises) is needed to know what's late. */
function countUrgent(tasks: MemberTask[]) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let overdue = 0;
  let dueToday = 0;
  for (const t of tasks) {
    if (!t.deadline) continue;
    if (t.deadline < iso) overdue++;
    else if (t.deadline === iso) dueToday++;
  }
  return { overdue, dueToday };
}

export function MyTasks({ tasks, username }: { tasks: MemberTask[]; username: string }) {
  const router = useRouter();
  const t = useT().home.tasks;
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      // Storage unavailable — the toggle just won't be remembered.
    }
    window.dispatchEvent(new Event("my-tasks-toggle"));
  }, [open]);

  if (tasks.length === 0) return null;

  const { overdue, dueToday } = countUrgent(tasks);

  return (
    <section aria-labelledby="my-tasks-heading" className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="my-tasks-list"
        title={open ? t.collapse : t.expand}
        className="group flex w-full items-center gap-2 text-left"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-foreground-faint transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
        <h2
          id="my-tasks-heading"
          className="text-lg font-semibold tracking-tight text-foreground transition-colors group-hover:text-accent"
        >
          {t.title}
        </h2>
        <span className="text-xs text-foreground-faint">
          @{username} · {t.count(tasks.length)}
        </span>
        {/* What urges, readable without opening the section. */}
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            {t.overdue(overdue)}
          </span>
        )}
        {dueToday > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            {t.dueToday(dueToday)}
          </span>
        )}
      </button>

      {/* Grid trick from .disclosure-row: height doesn't interpolate to auto.
          `inert` while closed keeps 25 collapsed cards out of the tab order AND
          out of the accessibility tree — the row is still painted (at 0fr), so
          hiding it visually isn't enough. The closed margin cancels the one
          `space-y-3` gap the button above leaves behind. */}
      <div
        id="my-tasks-list"
        className="disclosure-row"
        data-open={open ? "true" : "false"}
        inert={!open}
        style={{ ["--disclosure-closed-mt" as string]: "-0.75rem" }}
      >
        <div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((task, i) => (
              <button
                key={i}
                type="button"
                onClick={() => router.push(`/kanban?open=${encodeURIComponent(task.id)}`)}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-foreground/[0.04]"
                title={t.open}
              >
                {task.labels && task.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {task.labels.slice(0, 3).map((label) => (
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

                <p className="line-clamp-2 text-sm text-foreground">{task.title}</p>

                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                  <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">
                    {task.status}
                  </span>
                  {task.number != null && (
                    <span className="font-mono tabular-nums text-[11px] text-foreground-subtle">#{task.number}</span>
                  )}
                  <FirePriority value={task.firePriority} />
                  <DeadlineChip value={task.deadline} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
