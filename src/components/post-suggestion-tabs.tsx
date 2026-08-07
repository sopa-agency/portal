"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Sparkles, GitBranch, CalendarDays, Users } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { useT } from "@/components/locale-provider";

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
  const t = useT().postSuggestions.tabs;
  // Shareable: active tab in ?tab=.
  const [rawTab, setTab] = useUrlTab("tab", initial);
  const tabs = [
    { key: "community" as const, label: t.community, icon: Sparkles },
    { key: "repo" as const, label: t.repo, icon: GitBranch },
    ...(crosspost ? [{ key: "crosspost" as const, label: t.crosspost, icon: Users }] : []),
    ...(calendar ? [{ key: "calendar" as const, label: t.calendar, icon: CalendarDays }] : []),
  ];
  // Fall back when the URL names a tab this project doesn't have — a
  // ?tab=crosspost link shared from a project that has the queue would
  // otherwise land on a blank pane with no tab to click back from.
  const tab = (tabs.some((x) => x.key === rawTab) ? rawTab : initial) as TabKey;

  // The thumb's geometry is written straight to the DOM as custom properties
  // rather than kept in state: it changes on every resize and font load, and
  // none of that should cost a React render.
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<TabKey, HTMLButtonElement>());

  const positionThumb = useCallback(() => {
    const list = listRef.current;
    const button = buttonRefs.current.get(tab);
    if (!list || !button) return;
    list.style.setProperty("--seg-x", `${button.offsetLeft}px`);
    list.style.setProperty("--seg-w", `${button.offsetWidth}px`);
  }, [tab]);

  useLayoutEffect(() => {
    positionThumb();
    // Arm the transition only after the first position is painted, so the
    // thumb doesn't slide in from the left edge on load.
    const id = requestAnimationFrame(() => {
      listRef.current?.setAttribute("data-ready", "true");
    });
    return () => cancelAnimationFrame(id);
  }, [positionThumb]);

  // Labels change width when the language switches, and the tab list itself
  // grows when a project has the cross-post queue. Watch instead of guessing.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(positionThumb);
    observer.observe(list);
    for (const button of buttonRefs.current.values()) observer.observe(button);
    return () => observer.disconnect();
  }, [positionThumb]);

  // Arrow keys walk the tabs, which is what a tablist is expected to do once
  // it claims the role. Roving tabindex keeps Tab itself moving to the panel.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((x) => x.key === tab);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    setTab(next.key);
    buttonRefs.current.get(next.key)?.focus();
  };

  const panes: { key: TabKey; node: ReactNode }[] = [
    { key: "community", node: community },
    { key: "repo", node: repo },
    ...(crosspost ? [{ key: "crosspost" as const, node: crosspost }] : []),
    ...(calendar ? [{ key: "calendar" as const, node: calendar }] : []),
  ];

  return (
    <div className="space-y-6">
      <div
        ref={listRef}
        role="tablist"
        aria-label={t.label}
        onKeyDown={onKeyDown}
        className="segmented inline-flex rounded-xl border border-border p-1"
      >
        <span className="segmented-thumb" aria-hidden="true" />
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            ref={(node) => {
              if (node) buttonRefs.current.set(key, node);
              else buttonRefs.current.delete(key);
            }}
            type="button"
            role="tab"
            id={`post-suggestions-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`post-suggestions-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            // The active label is plain foreground, not accent: on the light
            // thumb (white) the accent olive only reaches 3.4:1, short of the
            // 4.5 a 14px label needs. The accent moves to the icon, where 3:1
            // is the bar — brand colour without the legibility cost.
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors duration-200 ${
              tab === key ? "text-foreground" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon className={`h-4 w-4 transition-colors duration-200 ${tab === key ? "text-accent" : ""}`} />
            {label}
          </button>
        ))}
      </div>
      {/* Panes stay mounted so switching tabs doesn't drop in-flight runs/edits. */}
      {panes.map(({ key, node }) => (
        <div
          key={key}
          role="tabpanel"
          id={`post-suggestions-panel-${key}`}
          aria-labelledby={`post-suggestions-tab-${key}`}
          className={tab === key ? "" : "hidden"}
        >
          {node}
        </div>
      ))}
    </div>
  );
}
