import {
  Activity,
  Target,
  AlertTriangle,
  GitCommit,
  Zap,
  Users,
  FileText,
  Library,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { BriefingKind } from "@/lib/morning-briefing";
import { MarkdownContent } from "@/components/markdown-content";
import type { IssueIndex } from "@/lib/issue-index";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type SectionStyle = {
  icon: Icon;
  label: string;
  /** Ledger accent bar + eyebrow color (Split Desk design). */
  bar: string;
  badge: string;
};

const STYLES: Record<BriefingKind, SectionStyle> = {
  status: { icon: Activity, label: "Status", bar: "bg-accent", badge: "text-accent" },
  priorities: { icon: Target, label: "Priorities", bar: "bg-accent", badge: "text-accent" },
  risks: { icon: AlertTriangle, label: "Risks", bar: "bg-warning", badge: "text-warning" },
  changes: { icon: GitCommit, label: "Changes", bar: "bg-border-strong", badge: "text-foreground-subtle" },
  actions: { icon: Zap, label: "Next actions", bar: "bg-accent", badge: "text-accent" },
  coordination: { icon: Users, label: "Coordination", bar: "bg-border-strong", badge: "text-foreground-subtle" },
  sources: { icon: Library, label: "Sources", bar: "bg-border-strong", badge: "text-foreground-subtle" },
  generic: { icon: FileText, label: "Notes", bar: "bg-border-strong", badge: "text-foreground-subtle" },
};

/**
 * Ledger-style section (Split Desk design): a thin accent bar, a compact
 * uppercase eyebrow, and tight action-point bullets — no card chrome.
 */
export function BriefingSection({
  heading,
  kind,
  body,
  githubRepo,
  issueInfo,
}: {
  heading: string;
  kind: BriefingKind;
  body: string;
  githubRepo?: string;
  issueInfo?: IssueIndex;
}) {
  const style = STYLES[kind];
  const Icon = style.icon;
  const eyebrow =
    heading && heading.toLowerCase() !== style.label.toLowerCase()
      ? `${style.label} · ${heading}`
      : style.label;
  return (
    <section className="flex gap-3.5">
      <div className={`w-[3px] shrink-0 rounded-full opacity-50 ${style.bar}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={`mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] ${style.badge}`}>
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{eyebrow}</span>
        </div>
        <div className="text-[13.5px] leading-relaxed [&_li]:my-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm">
          <MarkdownContent markdown={body} githubRepo={githubRepo} issueInfo={issueInfo} />
        </div>
      </div>
    </section>
  );
}

export function BriefingSources({
  heading,
  body,
  githubRepo,
  issueInfo,
}: {
  heading: string;
  body: string;
  githubRepo?: string;
  issueInfo?: IssueIndex;
}) {
  return (
    <details className="group rounded-2xl border border-border bg-surface/40 px-5 py-4 open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-foreground-subtle [&::-webkit-details-marker]:hidden">
        <Library className="h-3.5 w-3.5" />
        <span className="font-semibold uppercase tracking-[0.18em]">{heading}</span>
        <span className="ml-auto text-[10px] text-foreground-faint group-open:hidden">
          expand
        </span>
        <span className="ml-auto hidden text-[10px] text-foreground-faint group-open:inline">
          collapse
        </span>
      </summary>
      <div className="mt-3 border-t border-border pt-3">
        <MarkdownContent markdown={body} githubRepo={githubRepo} issueInfo={issueInfo} />
      </div>
    </details>
  );
}
