"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import { FeedbackButton } from "@/components/insight-feedback";
import {
  generateAnalyticsInsights,
  getLatestAnalyticsInsight,
} from "@/app/actions/analytics-insights";

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

export function AnalyticsInsights({
  days,
  agentName,
}: {
  days: 7 | 28 | 90;
  agentName?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<{ at: string; by: string | null } | null>(null);

  const hydrate = useCallback(async () => {
    try {
      const saved = await getLatestAnalyticsInsight();
      if (saved) {
        setResult(saved.body);
        setLastUpdated({ at: saved.generatedAt, by: saved.generatedBy });
      }
    } catch {
      // Silently ignore hydration errors — the generate button still works.
    }
  }, []);

  useEffect(() => {
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const r = await generateAnalyticsInsights(days);
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
            <p className="text-sm font-semibold text-foreground">AI analysis</p>
            <p className="text-xs text-foreground-subtle">
              {agentName
                ? `${agentName} reads the numbers`
                : "The project agent reads the numbers"}{" "}
              and suggests SEO &amp; growth actions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <FeedbackButton kind="analytics" label="analytics insights" />
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
              Re-analyze ({days}d)
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Analyze with AI ({days}d)
            </>
          )}
        </button>
        </div>
      </div>

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
          Reading {days}-day analytics data and thinking through SEO &amp; growth
          moves… this can take a minute.
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
