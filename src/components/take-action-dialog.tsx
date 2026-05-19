"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw, Sparkles, X, Zap } from "lucide-react";
import {
  executeBriefingAction,
  proposeBriefingAction,
  regenerateBriefing,
} from "@/app/actions/briefings";
import { MarkdownContent } from "@/components/markdown-content";

type Step = "proposal" | "executing" | "result";

export function TakeActionButton({
  agentSlug,
  agentLabel,
}: {
  agentSlug: string;
  agentLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("proposal");
  const [proposal, setProposal] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const reset = () => {
    setStep("proposal");
    setProposal("");
    setResult("");
    setError(null);
    setExecuting(false);
    setRegenerating(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const propose = () => {
    setOpen(true);
    reset();
    startTransition(async () => {
      const r = await proposeBriefingAction(agentSlug);
      if (r.ok) setProposal(r.proposal);
      else setError(r.error);
    });
  };

  const execute = async () => {
    if (!proposal) return;
    setExecuting(true);
    setStep("executing");
    setError(null);
    const r = await executeBriefingAction(agentSlug, proposal);
    setExecuting(false);
    if (!r.ok) {
      setStep("proposal");
      setError(r.error);
      return;
    }
    setResult(r.result);
    setStep("result");
    router.refresh();
  };

  const rerunBriefing = async () => {
    setRegenerating(true);
    setError(null);
    const r = await regenerateBriefing(agentSlug, "pt");
    setRegenerating(false);
    if (!r.ok) {
      setError(r.error ?? "Failed to regenerate");
      return;
    }
    router.refresh();
    close();
  };

  return (
    <>
      <button
        type="button"
        onClick={propose}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Take action
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                  {step === "result" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-accent" />
                  )}
                  {step === "result" ? "Action complete" : "Confirm project action"}
                </h2>
                <p className="mt-0.5 truncate text-xs text-foreground-subtle">
                  <span className="font-mono">{agentLabel}</span> · based on the latest briefing
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-1.5 text-foreground-subtle hover:bg-foreground/5 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {pending && (
                <LoadingBlock label="Asking the project agent what it recommends…" hint="~30–60s" />
              )}

              {step === "executing" && (
                <LoadingBlock label="Agent is executing the approved action…" hint="~30–120s" />
              )}

              {error && !pending && step !== "executing" && (
                <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  <p className="font-semibold">Failed</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs">{error}</pre>
                </div>
              )}

              {step === "proposal" && proposal && !pending && (
                <div className="rounded-xl border border-border bg-surface-elevated p-4">
                  <MarkdownContent markdown={proposal} />
                </div>
              )}

              {step === "result" && result && (
                <div className="rounded-xl border border-border bg-surface-elevated p-4">
                  <MarkdownContent markdown={result} />
                </div>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              {step === "proposal" && (
                <>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-border bg-foreground/5 px-3 py-1.5 text-sm text-foreground-muted hover:bg-foreground/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={execute}
                    disabled={!proposal || executing || pending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
                  >
                    {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Confirm & run
                  </button>
                </>
              )}

              {step === "result" && (
                <>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-border bg-foreground/5 px-3 py-1.5 text-sm text-foreground-muted hover:bg-foreground/10"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={rerunBriefing}
                    disabled={regenerating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
                  >
                    {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Rerun briefing
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function LoadingBlock({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-foreground-muted">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
      {hint && <p className="text-[11px] text-foreground-subtle">{hint}</p>}
    </div>
  );
}
