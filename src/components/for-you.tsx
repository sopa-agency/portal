import Link from "next/link";
import { Sparkles, AtSign } from "lucide-react";
import type { MemberTask } from "@/app/actions/team-admin";

// Personalized "For You" band on the SOPA home: the logged-in member's own
// tasks across every portal + any briefing next-actions that name them.

export type ForYouMention = { agentLabel: string; text: string };

const STATUS_TONE: Record<string, string> = {
  "in progress": "bg-warning/15 text-warning",
  "in review": "bg-accent-bg text-accent",
  todo: "bg-foreground/10 text-foreground-muted",
  "ready": "bg-success/15 text-success",
  done: "bg-success/15 text-success",
};

export function ForYou({
  username,
  tasks,
  mentions,
}: {
  username: string;
  tasks: MemberTask[];
  mentions: ForYouMention[];
}) {
  const open = tasks.filter((t) => !/done|closed/i.test(t.status) && t.state !== "CLOSED");
  const shown = open.slice(0, 8);

  return (
    <section className="rounded-2xl border border-accent-border bg-accent-bg/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          For you, <span className="text-accent">@{username}</span>
        </h2>
        <span className="text-xs text-foreground-faint">{open.length} tasks abertas · {mentions.length} menções</span>
      </div>

      {mentions.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Citado nos briefings</p>
          {mentions.slice(0, 4).map((m, i) => (
            <p key={i} className="flex gap-2 text-sm text-foreground-muted">
              <AtSign className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span><span className="text-foreground-subtle">{m.agentLabel}:</span> {m.text}</span>
            </p>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-foreground-faint">Sem tasks abertas atribuídas a você nos boards. 🎉</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Suas tasks (todos os portais)</p>
          {shown.map((t) => (
            <Link
              key={t.id}
              href={`/kanban?open=${t.id}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:border-border-strong"
            >
              {t.board && (
                <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle">{t.board}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[t.status.toLowerCase()] ?? "bg-foreground/10 text-foreground-muted"}`}>
                {t.status}
              </span>
            </Link>
          ))}
          {open.length > shown.length && (
            <Link href="/kanban" className="block pt-1 text-xs text-foreground-subtle underline hover:text-foreground">
              ver todas as {open.length} →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
