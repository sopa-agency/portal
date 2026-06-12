"use client";

import { useState, type ReactNode } from "react";
import { Sparkles, GitBranch } from "lucide-react";

// Tab switch for the consolidated Post Suggestions page: community-driven
// drafts vs commit-driven drafts (the former Repo to Social route).
export function PostSuggestionTabs({
  initial,
  community,
  repo,
}: {
  initial: "community" | "repo";
  community: ReactNode;
  repo: ReactNode;
}) {
  const [tab, setTab] = useState<"community" | "repo">(initial);
  const tabs = [
    { key: "community" as const, label: "Community", icon: Sparkles },
    { key: "repo" as const, label: "Repo to Social", icon: GitBranch },
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
      {/* Both panes stay mounted so switching tabs doesn't drop in-flight runs/edits. */}
      <div className={tab === "community" ? "" : "hidden"}>{community}</div>
      <div className={tab === "repo" ? "" : "hidden"}>{repo}</div>
    </div>
  );
}
