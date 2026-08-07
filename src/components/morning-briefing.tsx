import { AlertCircle } from "lucide-react";
import type {
  Briefing,
  BriefingAgent,
  BriefingSection as Section,
} from "@/lib/morning-briefing";
import { BriefingSection, BriefingSources } from "@/components/briefing-section";
import { MarkdownContent } from "@/components/markdown-content";
import { BriefingOptions } from "@/components/briefing-options";
import type { IssueIndex } from "@/lib/issue-index";

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
  teamEmails = [],
  projectName = "",
  githubRepo,
  postCreatorEnabled = false,
  issueInfo,
}: {
  briefing: Briefing;
  teamEmails?: string[];
  projectName?: string;
  githubRepo?: string;
  postCreatorEnabled?: boolean;
  issueInfo?: IssueIndex;
}) {
  const { status, actions, sources, middle } = partitionSections(briefing.sections);
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
        {/* No date, no freshness badge: the page header carries both once,
            beside the Regenerate button. Two agents meant the same day and the
            same "stale" were printed three times on one screen. */}
        <div className="flex items-center gap-2">
          <BriefingOptions
            agentSlug={briefing.agent.slug}
            agentLabel={briefing.agent.label}
            briefingDate={briefing.date}
            markdownBody={briefing.rawBody}
            projectName={projectName}
            githubRepo={githubRepo}
            postCreatorEnabled={postCreatorEnabled}
            teamEmails={teamEmails}
          />
        </div>
      </header>

      {!hasAnySections && briefing.preamble && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <MarkdownContent markdown={briefing.preamble} githubRepo={githubRepo} issueInfo={issueInfo} />
        </section>
      )}

      {status.map((s, i) => (
        <BriefingSection key={`status-${i}`} {...s} githubRepo={githubRepo} issueInfo={issueInfo} />
      ))}

      {/* Ledger flow (Split Desk design): compact vertical action points. */}
      {middle.map((s, i) => (
        <BriefingSection key={`middle-${i}`} {...s} githubRepo={githubRepo} issueInfo={issueInfo} />
      ))}

      {actions.map((s, i) => (
        <BriefingSection key={`actions-${i}`} {...s} githubRepo={githubRepo} issueInfo={issueInfo} />
      ))}

      {sources.map((s, i) => (
        <BriefingSources key={`sources-${i}`} heading={s.heading} body={s.body} githubRepo={githubRepo} issueInfo={issueInfo} />
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
