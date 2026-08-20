"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import { FeedbackButton } from "@/components/insight-feedback";
import {
  generateSocialInsights,
  getLatestSocialInsight,
} from "@/app/actions/social-insights";

// ---------------------------------------------------------------------------
// Relative-time helper (no dependency needed for this granularity)
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// "Generate AI insights" panel: feeds the channel's live metrics + strategy to
// the project's agent and renders its outreach/engagement recommendations.
// Persists the latest result in the DB and re-hydrates on mount so insights
// survive navigation.
export function SocialInsights({
  platform,
  agentName,
}: {
  platform: string;
  agentName?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Metadata from the persisted row (ISO string + optional username)
  const [lastUpdated, setLastUpdated] = useState<{
    at: string;
    by: string | null;
  } | null>(null);

  // Hydrate from DB on mount
  const hydrate = useCallback(async () => {
    try {
      const saved = await getLatestSocialInsight(platform);
      if (saved) {
        setResult(saved.body);
        setLastUpdated({ at: saved.generatedAt, by: saved.generatedBy });
      }
    } catch {
      // Silently ignore hydration errors — the generate button still works.
    }
  }, [platform]);

  useEffect(() => {
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const r = await generateSocialInsights(platform);
      if (r.ok) {
        setResult(r.text);
        setLastUpdated({ at: new Date().toISOString(), by: null });
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-bg">
            <Sparkles className="h-4 w-4 text-accent" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">AI insights</p>
            <p className="text-xs text-foreground-subtle">
              {agentName
                ? `${agentName} reads the numbers`
                : "The project agent reads the numbers"}{" "}
              and suggests better outreach &amp; engagement.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <FeedbackButton kind="social" channelKey={platform} label={`${platform} insights`} />
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3.5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing…
            </>
          ) : result ? (
            <>
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate AI insights
            </>
          )}
        </button>
        </div>
      </div>

      {/* Last-updated line — shown once we have a result */}
      {lastUpdated && !pending && (
        <p className="mt-2 text-xs text-foreground-subtle">
          Updated {relativeTime(lastUpdated.at)}
          {lastUpdated.by ? ` by @${lastUpdated.by}` : ""}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {pending && !result && (
        <p className="mt-4 text-xs text-foreground-subtle">
          Reading {platform} metrics and progress, then thinking through outreach &amp;
          engagement moves… this can take a minute.
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated px-4 py-3">
          <MarkdownContent markdown={result} />
        </div>
      )}
    </div>
  );
}
