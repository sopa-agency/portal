import Link from "next/link";
import { ListChecks, CircleAlert } from "lucide-react";

// SOPA home — an aggregated morning briefing: each project's NEXT ACTIONS
// (pulled from its latest briefing's "Próximas ações" section), in one view,
// so the team starts the day/week with the whole org's to-dos at a glance.

export type SopaActionGroup = {
  projectSlug: string;
  projectName: string;
  agentLabel: string;
  date: string | null;
  fresh: boolean; // briefing is from today
  actions: string[]; // bullet lines (markdown stripped)
  error?: string;
};

export function SopaBriefing({ groups, today }: { groups: SopaActionGroup[]; today: string }) {
  const totalActions = groups.reduce((n, g) => n + g.actions.length, 0);
  const freshCount = groups.filter((g) => g.fresh).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <ListChecks className="h-5 w-5 text-accent" /> Next actions de todos os projetos
        </h2>
        <span className="text-xs text-foreground-faint">
          {totalActions} ações · {freshCount}/{groups.length} briefings de hoje
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <div key={`${g.projectSlug}-${g.agentLabel}`} className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{g.agentLabel}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  g.fresh ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                }`}
              >
                {g.date ? (g.fresh ? "hoje" : g.date) : "sem briefing"}
              </span>
            </div>

            {g.error ? (
              <p className="flex items-center gap-1.5 text-xs text-foreground-faint">
                <CircleAlert className="h-3.5 w-3.5" /> {g.error}
              </p>
            ) : g.actions.length === 0 ? (
              <p className="text-xs text-foreground-faint">Sem next actions no último briefing.</p>
            ) : (
              <ul className="space-y-1.5">
                {g.actions.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-foreground-faint">
        Puxado dos morning briefings de cada portal ({today}). Detalhe completo em cada projeto.{" "}
        <Link href="/treasury" className="underline hover:text-foreground">Treasury combinada →</Link>
      </p>
    </section>
  );
}
