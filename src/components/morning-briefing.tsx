import { AlertCircle, Calendar } from "lucide-react";
import type {
  Briefing,
  BriefingAgent,
  BriefingSection as Section,
} from "@/lib/morning-briefing";
import { freshnessLabel } from "@/lib/morning-briefing";
import { BriefingSection, BriefingSources } from "@/components/briefing-section";
import { MarkdownContent } from "@/components/markdown-content";
import { ImprovePromptButton } from "@/components/improve-prompt-dialog";
import { FeedbackButton } from "@/components/insight-feedback";
import { TakeActionButton } from "@/components/take-action-dialog";
import { EmailBriefingButton } from "@/components/email-briefing-dialog";

const FRESHNESS_BADGE: Record<
  ReturnType<typeof freshnessLabel>["tone"],
  string
> = {
  fresh: "border-accent-border bg-accent-bg text-accent",
  stale: "border-border text-foreground-muted",
  warn: "border-warning/30 bg-warning/10 text-warning",
};

function partitionSections(sections: Section[]) {
  const status: Section[] = [];
  const actions: Section[] = [];
  const sources: Section[] = [];
  const middle: Section[] = [];
  for (const s of sections) {
    if (s.kind === "status") status.push(s);
    else if (s.kind === "actions") actions.push(s);
    else if (s.kind === "sources") sources.push(s);
    else middle.push(s);
  }
  return { status, actions, sources, middle };
}

export function MorningBriefing({
  briefing,
  today,
  teamEmails = [],
  projectName = "",
  githubRepo,
}: {
  briefing: Briefing;
  today: string;
  teamEmails?: string[];
  projectName?: string;
  githubRepo?: string;
}) {
  const { status, actions, sources, middle } = partitionSections(briefing.sections);
  const freshness = freshnessLabel(briefing.date, today);
  const hasAnySections = briefing.sections.length > 0;

  return (
    <article className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {briefing.agent.label}
          </h2>
          <span className="text-xs text-foreground-subtle">@{briefing.agent.slug}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
            <Calendar className="h-3.5 w-3.5" />
            {briefing.date}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${FRESHNESS_BADGE[freshness.tone]}`}
          >
            {freshness.label}
          </span>
          <ImprovePromptButton agentSlug={briefing.agent.slug} agentLabel={briefing.agent.label} />
          <FeedbackButton kind="briefing" channelKey={briefing.agent.slug} label={`${briefing.agent.label} briefing`} />
          <TakeActionButton agentSlug={briefing.agent.slug} agentLabel={briefing.agent.label} githubRepo={githubRepo} />
          {teamEmails.length > 0 && (
            <EmailBriefingButton
              agentSlug={briefing.agent.slug}
              agentLabel={briefing.agent.label}
              briefingDate={briefing.date}
              markdownBody={briefing.rawBody}
              projectName={projectName}
            />
          )}
        </div>
      </header>

      {!hasAnySections && briefing.preamble && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <MarkdownContent markdown={briefing.preamble} githubRepo={githubRepo} />
        </section>
      )}

      {status.map((s, i) => (
        <BriefingSection key={`status-${i}`} {...s} githubRepo={githubRepo} />
      ))}

      {/* Ledger flow (Split Desk design): compact vertical action points. */}
      {middle.map((s, i) => (
        <BriefingSection key={`middle-${i}`} {...s} githubRepo={githubRepo} />
      ))}

      {actions.map((s, i) => (
        <BriefingSection key={`actions-${i}`} {...s} githubRepo={githubRepo} />
      ))}

      {sources.map((s, i) => (
        <BriefingSources key={`sources-${i}`} heading={s.heading} body={s.body} githubRepo={githubRepo} />
      ))}
    </article>
  );
}

export function BriefingMissing({
  agent,
  error,
}: {
  agent: BriefingAgent;
  error: string;
}) {
  return (
    <article className="space-y-3">
      <header className="flex items-baseline gap-3 border-b border-border pb-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{agent.label}</h2>
        <span className="text-xs text-foreground-subtle">@{agent.slug}</span>
      </header>
      <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-5 text-sm text-warning">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">No briefing available.</p>
          <p className="text-warning/80">{error}</p>
          <p className="text-xs text-foreground-subtle">
            Briefings live in Postgres now. Hit Regenerate to create one, or wait for the
            next cron run on the Mac mini.
          </p>
        </div>
      </div>
    </article>
  );
}
