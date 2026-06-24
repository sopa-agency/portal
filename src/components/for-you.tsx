"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, AtSign } from "lucide-react";
import type { MemberTask } from "@/app/actions/team-admin";
import type { AggregatedItem } from "@/lib/github-project";
import { CardDialogHost } from "@/components/card-dialog-host";

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

/** Lower = higher priority; unset sorts last. Handles P0–P3 and Urgent/High/Medium/Low (+ PT). */
function priorityRank(p?: string): number {
  if (!p) return 99;
  const s = p.toLowerCase();
  const pn = s.match(/\bp\s*(\d)\b/);
  if (pn) return Number(pn[1]);
  if (/urgent|critical|cr[ií]tic/.test(s)) return 0;
  if (/high|alta/.test(s)) return 1;
  if (/med/.test(s)) return 2;
  if (/low|baixa/.test(s)) return 3;
  return 90; // known-but-unrecognized value, still before "no priority"
}

/** Badge tone for a priority value. */
function priorityTone(p: string): string {
  const r = priorityRank(p);
  if (r <= 0) return "bg-danger/15 text-danger";
  if (r === 1) return "bg-warning/15 text-warning";
  if (r === 2) return "bg-accent-bg text-accent";
  return "bg-foreground/10 text-foreground-subtle";
}

export function ForYou({
  username,
  tasks,
  mentions,
}: {
  username: string;
  tasks: MemberTask[];
  mentions: ForYouMention[];
}) {
  // Open tasks, highest priority first (stable: equal priority keeps board order).
  const open = tasks
    .filter((t) => !/done|closed/i.test(t.status) && t.state !== "CLOSED")
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const shown = open.slice(0, 8);
  const [card, setCard] = useState<AggregatedItem | null>(null);

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
          {shown.map((t) =>
            t.card ? (
              <button
                key={t.id}
                type="button"
                onClick={() => setCard(t.card!)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-sm transition-colors hover:border-border-strong"
              >
                {t.board && (
                  <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle">{t.board}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
                {t.priority && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityTone(t.priority)}`}>
                    {t.priority}
                  </span>
                )}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[t.status.toLowerCase()] ?? "bg-foreground/10 text-foreground-muted"}`}>
                  {t.status}
                </span>
              </button>
            ) : (
              <Link
                key={t.id}
                href={`/kanban?open=${t.id}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:border-border-strong"
              >
                {t.board && (
                  <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle">{t.board}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
                {t.priority && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityTone(t.priority)}`}>
                    {t.priority}
                  </span>
                )}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[t.status.toLowerCase()] ?? "bg-foreground/10 text-foreground-muted"}`}>
                  {t.status}
                </span>
              </Link>
            ),
          )}
          {open.length > shown.length && (
            <Link href="/kanban" className="block pt-1 text-xs text-foreground-subtle underline hover:text-foreground">
              ver todas as {open.length} →
            </Link>
          )}
        </div>
      )}

      {card && <CardDialogHost item={card} onClose={() => setCard(null)} />}
    </section>
  );
}
