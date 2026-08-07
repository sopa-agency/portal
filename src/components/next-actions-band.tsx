import { Zap } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import type { IssueIndex } from "@/lib/issue-index";
import type { Dictionary } from "@/lib/i18n/dictionary";

export type NextAction = {
  /** Which agent asked for it — DEV and MKT land in the same list. */
  agentLabel: string;
  agentSlug: string;
  /** Raw markdown of the bullet, so `#145` keeps its hover card. */
  text: string;
};

/**
 * Every agent's next actions, in one block above the columns.
 *
 * They used to render last inside each briefing — after status, notes, risks
 * and changes — in the same flat style as everything else, which put the only
 * part of the page that asks the team to *do* something below the fold, twice,
 * in two different columns. Here it's one list: the day's work, each line
 * carrying the agent it came from.
 */
export function NextActionsBand({
  actions,
  t,
  githubRepo,
  issueInfo,
}: {
  actions: NextAction[];
  t: Dictionary["home"]["nextActions"];
  githubRepo?: string;
  issueInfo?: IssueIndex;
}) {
  if (actions.length === 0) return null;

  return (
    <section
      aria-labelledby="next-actions-heading"
      className="rounded-2xl border border-accent-border bg-accent-bg/40 p-5"
    >
      <h2
        id="next-actions-heading"
        className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground"
      >
        <Zap className="h-4 w-4 shrink-0 text-accent" />
        {t.title}
        <span className="ml-auto text-[10px] font-medium tracking-normal text-foreground-subtle">
          {t.count(actions.length)}
        </span>
      </h2>

      <ul className="space-y-2">
        {actions.map((action, i) => (
          <li key={i} className="flex gap-3">
            {/* The agent tag is fixed-width so the action text starts on one
                column — a ragged left edge is what makes a mixed list hard to
                scan. `muted`, not `faint`: at 10px over the tinted band, faint
                measures 2.3:1, and this label is the only thing saying which
                agent asked. */}
            <span
              className="mt-[3px] w-11 shrink-0 text-right text-[10px] font-bold uppercase tracking-wider text-foreground-muted"
              title={`@${action.agentSlug}`}
            >
              {action.agentLabel}
            </span>
            <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed [&_p]:my-0">
              <MarkdownContent markdown={action.text} githubRepo={githubRepo} issueInfo={issueInfo} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
