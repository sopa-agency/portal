"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import { FeedbackButton } from "@/components/insight-feedback";
import {
  generateAnalyticsInsights,
  getLatestAnalyticsInsight,
} from "@/app/actions/analytics-insights";
import { useT } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";

function relativeTime(iso: string, t: Dictionary["analytics"]["state"]): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t.justNow;
  if (mins < 60) return t.minutesAgo(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t.hoursAgo(hrs);
  return t.daysAgo(Math.floor(hrs / 24));
}

export function AnalyticsInsights({
  days,
  agentName,
}: {
  days: 7 | 28 | 90;
  agentName?: string;
}) {
  const t = useT().analytics;
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
            <p className="text-sm font-semibold text-foreground">{t.insights.title}</p>
            <p className="text-xs text-foreground-subtle">
              {t.insights.blurb(agentName || t.insights.defaultAgent)}
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
              {t.insights.analyzing}
            </>
          ) : result ? (
            <>
              <RefreshCw className="h-4 w-4" />
              {t.insights.reanalyze(days)}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {t.insights.analyze(days)}
            </>
          )}
        </button>
        </div>
      </div>

      {lastUpdated && !pending && (
        <p className="mt-2 text-xs text-foreground-subtle">
          {lastUpdated.by
            ? t.insights.updatedBy(relativeTime(lastUpdated.at, t.state), lastUpdated.by)
            : t.insights.updated(relativeTime(lastUpdated.at, t.state))}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {pending && !result && (
        <p className="mt-4 text-xs text-foreground-subtle">
          {t.insights.working(days)}
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
