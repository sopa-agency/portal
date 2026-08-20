import Link from "next/link";
import { CalendarCheck, KanbanSquare } from "lucide-react";
import type { OpenMeetingAction } from "@/lib/meetings-context";

// SOPA home panel: open action items pulled straight from recent meetings,
// grouped by target project. The direct "reunião → o que ficou pra fazer"
// surface (independent of the per-agent briefing). Empty → renders nothing.
export function MeetingCoordination({
  actions,
  projectNames,
  today,
}: {
  actions: OpenMeetingAction[];
  projectNames: Record<string, string>;
  today: string;
}) {
  if (!actions.length) return null;

  const order: string[] = [];
  const byProject = new Map<string, OpenMeetingAction[]>();
  for (const a of actions) {
    const key = a.project || "geral";
    if (!byProject.has(key)) { byProject.set(key, []); order.push(key); }
    byProject.get(key)!.push(a);
  }
  const label = (key: string) => (key === "geral" ? "Transversal" : projectNames[key] ?? key);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <CalendarCheck className="h-5 w-5 text-accent" /> Coordenação · reuniões
        </h2>
        <Link href="/reunioes" className="text-xs font-medium text-foreground-muted hover:text-foreground">
          Ver reuniões →
        </Link>
      </div>
      <p className="mb-4 text-xs text-foreground-faint">Ações em aberto das reuniões recentes — {actions.length} pendente(s).</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {order.map((key) => {
          const group = byProject.get(key)!;
          return (
            <div key={key} className="rounded-xl border border-border bg-surface-elevated p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{label(key)}</span>
                <span className="text-[10px] text-foreground-faint">{group.length}</span>
              </div>
              <ul className="space-y-1.5">
                {group.slice(0, 6).map((a) => {
                  const overdue = a.deadline && a.deadline < today;
                  return (
                    <li key={`${a.meetingId}-${a.id}`} className="flex items-start gap-1.5 text-xs text-foreground-muted">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-foreground-faint" />
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground">{a.text}</span>
                        <span className="ml-1 whitespace-nowrap text-[10px]">
                          {a.owner ? <span className="text-accent">@{a.owner} </span> : null}
                          {a.priority ? <span title={`prioridade ${a.priority}`}>{"🔥".repeat(a.priority)} </span> : null}
                          {a.deadline ? <span className={overdue ? "text-danger" : "text-foreground-faint"}>⏰{a.deadline} </span> : null}
                          {a.carded ? <KanbanSquare className="inline h-3 w-3 text-success" aria-label="virou card" /> : null}
                        </span>
                      </span>
                    </li>
                  );
                })}
                {group.length > 6 && <li className="text-[10px] text-foreground-faint">+{group.length - 6} mais</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
