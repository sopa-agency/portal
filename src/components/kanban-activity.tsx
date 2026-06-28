import { GitMerge, GitPullRequest, CircleDot, CheckCircle2 } from "lucide-react";
import type { KanbanActivityEvent } from "@/lib/github-project";

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}sem`;
}

const VERB: Record<KanbanActivityEvent["kind"], string> = {
  opened: "abriu",
  closed: "fechou",
  merged: "mergeou",
};

function EventIcon({ ev }: { ev: KanbanActivityEvent }) {
  if (ev.kind === "merged") return <GitMerge className="h-3.5 w-3.5 shrink-0 text-[#a371f7]" />;
  if (ev.kind === "closed")
    return ev.type === "pr"
      ? <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-danger" />
      : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />;
  return <CircleDot className="h-3.5 w-3.5 shrink-0 text-success" />;
}

/** GitHub kanban activity — recent opens/closes/merges across all boards. */
export function KanbanActivity({ events }: { events: KanbanActivityEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="activity-heading">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id="activity-heading" className="text-sm font-semibold tracking-tight text-foreground">
          Atividade
        </h2>
        <span className="text-[11px] text-foreground-faint">Kanban · GitHub</span>
      </div>
      <ol className="space-y-1.5">
        {events.map((ev, i) => {
          const row = (
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-elevated">
              <EventIcon ev={ev} />
              <span className="shrink-0 text-[11px] font-medium text-foreground-muted">{VERB[ev.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                {ev.number ? <span className="text-foreground-faint">#{ev.number} </span> : null}
                {ev.title}
              </span>
              <span
                className="hidden shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide sm:inline"
                style={{ color: ev.accent, backgroundColor: `${ev.accent}1a` }}
              >
                {ev.project}
              </span>
              {ev.assignees[0] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={ev.assignees[0].avatarUrl} alt={ev.assignees[0].login} className="hidden h-5 w-5 shrink-0 rounded-full sm:block" />
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-foreground-faint">{relTime(ev.ts)}</span>
            </div>
          );
          return (
            <li key={`${ev.url ?? ev.title}-${ev.kind}-${i}`}>
              {ev.url ? (
                <a href={ev.url} target="_blank" rel="noreferrer" className="block">{row}</a>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
