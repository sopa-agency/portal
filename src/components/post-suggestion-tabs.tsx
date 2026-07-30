"use client";

import { type ReactNode } from "react";
import { Sparkles, GitBranch, CalendarDays, Users } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";

type TabKey = "community" | "repo" | "crosspost" | "calendar";

// Tab switch for the consolidated Post Suggestions page: community-driven
// drafts, commit-driven drafts (the former Repo to Social route), and the
// cross-post queue members submit from the main app.
export function PostSuggestionTabs({
  initial,
  community,
  repo,
  crosspost,
  calendar,
}: {
  initial: TabKey;
  community: ReactNode;
  repo: ReactNode;
  crosspost?: ReactNode;
  calendar?: ReactNode;
}) {
  // Shareable: active tab in ?tab=.
  const [rawTab, setTab] = useUrlTab("tab", initial);
  const tab = (["community", "repo", "crosspost", "calendar"].includes(rawTab) ? rawTab : initial) as TabKey;
  const tabs = [
    { key: "community" as const, label: "Community", icon: Sparkles },
    { key: "repo" as const, label: "Repo to Social", icon: GitBranch },
    ...(crosspost ? [{ key: "crosspost" as const, label: "Cross-post", icon: Users }] : []),
    ...(calendar ? [{ key: "calendar" as const, label: "Calendar", icon: CalendarDays }] : []),
  ];
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl border border-border bg-surface p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-accent-bg text-accent"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {/* Panes stay mounted so switching tabs doesn't drop in-flight runs/edits. */}
      <div className={tab === "community" ? "" : "hidden"}>{community}</div>
      <div className={tab === "repo" ? "" : "hidden"}>{repo}</div>
      {crosspost && <div className={tab === "crosspost" ? "" : "hidden"}>{crosspost}</div>}
      {calendar && <div className={tab === "calendar" ? "" : "hidden"}>{calendar}</div>}
    </div>
  );
}
