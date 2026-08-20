"use client";

import { useMemo, useState } from "react";
import { GitMerge, GitPullRequest, CircleDot, CheckCircle2, MessageSquare } from "lucide-react";
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
  commented: "comentou em",
};

function EventIcon({ ev }: { ev: KanbanActivityEvent }) {
  if (ev.kind === "merged") return <GitMerge className="h-3.5 w-3.5 shrink-0 text-[#a371f7]" />;
  if (ev.kind === "commented") return <MessageSquare className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />;
  if (ev.kind === "closed")
    return ev.type === "pr"
      ? <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-danger" />
      : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />;
  return <CircleDot className="h-3.5 w-3.5 shrink-0 text-success" />;
}

export function KanbanActivity({ events }: { events: KanbanActivityEvent[] }) {
  const [project, setProject] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);

  const projects = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; accent: string }>();
    for (const e of events) if (!m.has(e.projectSlug)) m.set(e.projectSlug, { slug: e.projectSlug, name: e.project, accent: e.accent });
    return [...m.values()];
  }, [events]);

  const people = useMemo(() => {
    const m = new Map<string, { login: string; avatarUrl: string; n: number }>();
    for (const e of events) {
      if (!e.actor) continue;
      const cur = m.get(e.actor.login);
      if (cur) cur.n++;
      else m.set(e.actor.login, { login: e.actor.login, avatarUrl: e.actor.avatarUrl, n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  }, [events]);

  const filtered = useMemo(
    () => events.filter((e) => (!project || e.projectSlug === project) && (!person || e.actor?.login === person)),
    [events, project, person],
  );

  if (events.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="activity-heading">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id="activity-heading" className="text-sm font-semibold tracking-tight text-foreground">Atividade</h2>
        <span className="text-[11px] text-foreground-faint">Kanban · GitHub</span>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {projects.map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => setProject((cur) => (cur === p.slug ? null : p.slug))}
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors"
            style={
              project === p.slug
                ? { color: p.accent, backgroundColor: `${p.accent}1a`, borderColor: p.accent }
                : { color: "var(--color-foreground-muted)", borderColor: "var(--color-border)" }
            }
          >
            {p.name}
          </button>
        ))}
        {people.length > 0 && <span className="mx-1 h-3 w-px bg-border" />}
        {people.map((u) => (
          <button
            key={u.login}
            type="button"
            onClick={() => setPerson((cur) => (cur === u.login ? null : u.login))}
            title={`@${u.login} · ${u.n}`}
            className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[10px] transition-colors ${
              person === u.login ? "border-accent bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
            {u.login}
          </button>
        ))}
      </div>

      <ol className="space-y-1.5">
        {filtered.slice(0, 30).map((ev, i) => {
          const row = (
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-elevated">
              <EventIcon ev={ev} />
              {ev.actor && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={ev.actor.avatarUrl} alt={ev.actor.login} className="h-4 w-4 shrink-0 rounded-full" />
              )}
              <span className="shrink-0 text-[11px] font-medium text-foreground-muted">
                {ev.actor ? <span className="text-foreground">{ev.actor.login}</span> : null} {VERB[ev.kind]}
              </span>
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
              <span className="shrink-0 text-[11px] tabular-nums text-foreground-faint">{relTime(ev.ts)}</span>
            </div>
          );
          return (
            <li key={`${ev.url ?? ev.title}-${ev.kind}-${i}`}>
              {ev.url ? <a href={ev.url} target="_blank" rel="noreferrer" className="block">{row}</a> : row}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-2 py-3 text-center text-[12px] italic text-foreground-faint">Nada com esse filtro.</li>
        )}
      </ol>
    </section>
  );
}
