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

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type SectionStyle = {
  icon: Icon;
  label: string;
  card: string;
  badge: string;
  iconClass: string;
};

const STYLES: Record<BriefingKind, SectionStyle> = {
  status: {
    icon: Activity,
    label: "Status",
    card: "border-border bg-surface",
    badge: "text-foreground-subtle",
    iconClass: "text-accent",
  },
  priorities: {
    icon: Target,
    label: "Priorities",
    card: "border-accent-border bg-accent-bg",
    badge: "text-accent",
    iconClass: "text-accent",
  },
  risks: {
    icon: AlertTriangle,
    label: "Risks",
    card: "border-warning/30 bg-warning/5",
    badge: "text-warning",
    iconClass: "text-warning",
  },
  changes: {
    icon: GitCommit,
    label: "Changes",
    card: "border-border bg-surface",
    badge: "text-foreground-subtle",
    iconClass: "text-foreground-muted",
  },
  actions: {
    icon: Zap,
    label: "Next actions",
    card: "border-accent-border bg-accent-bg",
    badge: "text-accent",
    iconClass: "text-accent",
  },
  coordination: {
    icon: Users,
    label: "Coordination",
    card: "border-border bg-surface",
    badge: "text-foreground-subtle",
    iconClass: "text-foreground-muted",
  },
  sources: {
    icon: Library,
    label: "Sources",
    card: "border-border bg-surface/40",
    badge: "text-foreground-subtle",
    iconClass: "text-foreground-subtle",
  },
  generic: {
    icon: FileText,
    label: "Notes",
    card: "border-border bg-surface",
    badge: "text-foreground-subtle",
    iconClass: "text-foreground-muted",
  },
};

export function BriefingSection({
  heading,
  kind,
  body,
}: {
  heading: string;
  kind: BriefingKind;
  body: string;
}) {
  const style = STYLES[kind];
  const Icon = style.icon;
  return (
    <section className={`rounded-2xl border p-5 ${style.card}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${style.iconClass}`} />
        <span
          className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${style.badge}`}
        >
          {style.label}
        </span>
      </div>
      <h3 className="mb-3 text-base font-semibold text-foreground">{heading}</h3>
      <MarkdownContent markdown={body} />
    </section>
  );
}

export function BriefingSources({ heading, body }: { heading: string; body: string }) {
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
        <MarkdownContent markdown={body} />
      </div>
    </details>
  );
}
