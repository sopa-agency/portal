"use client";

import { useState } from "react";
import { Brain, X } from "lucide-react";
import { SocialInsights } from "@/components/social-insights";

// "AI insights" trigger for the Socials tab — opens the per-channel AI analysis
// in a dialog instead of rendering it inline down the page.
export function AiInsightsButton({ platform, agentName }: { platform: string; agentName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
      >
        <Brain className="h-3.5 w-3.5" /> AI insights
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Brain className="h-4 w-4 text-accent" /> AI insights · {platform}
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="text-foreground-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SocialInsights platform={platform} agentName={agentName} />
          </div>
        </div>
      )}
    </>
  );
}
