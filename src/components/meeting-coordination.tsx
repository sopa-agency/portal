import Link from "next/link";
import { CalendarCheck, KanbanSquare } from "lucide-react";
import type { OpenMeetingAction } from "@/lib/meetings-context";

// SOPA home panel: open action items pulled straight from recent meetings,
// grouped by target project. The direct "reunião → o que ficou pra fazer"
// surface (independent of the per-agent briefing). Empty → renders nothing.
//
// O painel encolhe quando a reunião mais nova já tem idade. O motivo não é
// estética: nem toda reunião é gravada, então um painel cheio não prova que a
// coordenação está em dia — prova só que a última reunião REGISTRADA deixou
// pendências. Aberto em tamanho real, ele afirma uma atualidade que não tem.
// Encolhido, ele diz a data e deixa o resto a um clique.
const DIAS_ATE_ENCOLHER = 14;

function diasDesde(iso: string): number {
  const d = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(d)) return 0;
  return Math.floor((Date.now() - d) / 86_400_000);
}
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

  const maisRecente = actions.reduce((max, a) => (a.meetingDate > max ? a.meetingDate : max), "");
  const idade = maisRecente ? diasDesde(maisRecente) : 0;
  const velho = idade > DIAS_ATE_ENCOLHER;

  const grade = (
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
  );

  if (velho) {
    return (
      <details className="group rounded-2xl border border-border bg-surface p-4">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
          <CalendarCheck className="h-4 w-4 text-foreground-faint" />
          <span className="font-semibold text-foreground">Coordenação · reuniões</span>
          <span className="text-xs text-foreground-faint">
            {actions.length} pendente(s) da última reunião registrada, de {maisRecente} — há {idade} dias.
          </span>
          <span className="text-xs text-foreground-faint underline group-open:hidden">abrir</span>
        </summary>
        <div className="mt-4">{grade}</div>
      </details>
    );
  }

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
      <p className="mb-4 text-xs text-foreground-faint">
        Ações em aberto das reuniões recentes — {actions.length} pendente(s), da reunião de {maisRecente}.
      </p>
      {grade}
    </section>
  );
}
