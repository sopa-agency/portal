"use client";

import { type ReactNode } from "react";
import { Sparkles, GitBranch, CalendarDays } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";

// Tab switch for the consolidated Post Suggestions page: community-driven
// drafts vs commit-driven drafts (the former Repo to Social route).
export function PostSuggestionTabs({
  initial,
  community,
  repo,
  calendar,
}: {
  initial: "community" | "repo" | "calendar";
  community: ReactNode;
  repo: ReactNode;
  calendar?: ReactNode;
}) {
  // Shareable: active tab in ?tab=.
  const [rawTab, setTab] = useUrlTab("tab", initial);
  const tab = (["community", "repo", "calendar"].includes(rawTab) ? rawTab : initial) as "community" | "repo" | "calendar";
  const tabs = [
    { key: "community" as const, label: "Community", icon: Sparkles },
    { key: "repo" as const, label: "Repo to Social", icon: GitBranch },
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
      {calendar && <div className={tab === "calendar" ? "" : "hidden"}>{calendar}</div>}
    </div>
  );
}
