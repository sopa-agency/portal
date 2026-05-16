"use client";

import { Sparkles, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import { generateCampaignArtifacts, generateCampaignBrief } from "@/app/actions/campaigns";

export function CampaignGenerateBar({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"brief" | "artifacts" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBrief = () => {
    setError(null);
    setRunning("brief");
    startTransition(async () => {
      const result = await generateCampaignBrief(campaignId);
      if (!result.ok) setError(result.error);
      setRunning(null);
    });
  };

  const runArtifacts = () => {
    setError(null);
    setRunning("artifacts");
    startTransition(async () => {
      const result = await generateCampaignArtifacts(campaignId);
      if (!result.ok) setError(result.error);
      setRunning(null);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runBrief}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {running === "brief" ? "Drafting brief…" : "Generate brief from title"}
        </button>
        <button
          type="button"
          onClick={runArtifacts}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {running === "artifacts"
            ? "Drafting snap, cast, tweets, Discord, email…"
            : "Generate everything from brief"}
        </button>
        {pending ? (
          <span className="text-[11px] text-foreground-subtle">This can take up to a minute.</span>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
