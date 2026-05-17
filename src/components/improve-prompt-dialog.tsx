"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, Sparkles, X } from "lucide-react";
import { improvePrompt, type PromptImprovement } from "@/app/actions/briefings";

export function ImprovePromptButton({
  agentSlug,
  agentLabel,
}: {
  agentSlug: string;
  agentLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PromptImprovement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setOpen(true);
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await improvePrompt(agentSlug);
      if (r.ok) setResult(r.improvement);
      else setError(r.error);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Improve prompt
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">Improve prompt</h2>
                <p className="mt-0.5 truncate text-xs text-foreground-subtle">
                  Critique + rewrite for <span className="font-mono">{agentLabel}</span> based on latest briefing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-foreground-subtle hover:bg-foreground/5 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {pending && (
                <div className="flex flex-col items-center gap-3 py-12 text-foreground-muted">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm">Asking the agent to critique itself…</p>
                  <p className="text-[11px] text-foreground-subtle">~30–60s</p>
                </div>
              )}

              {error && !pending && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  <p className="font-semibold">Failed</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs">{error}</pre>
                </div>
              )}

              {result && !pending && (
                <div className="space-y-6">
                  <Section title="Critique" subtitle="What's weak about the current briefing">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
                      {result.critique}
                    </p>
                  </Section>

                  <Section
                    title="Manual setup"
                    subtitle="Connect/configure these so the agent has better data"
                  >
                    {result.manualSetup.length === 0 ? (
                      <p className="text-xs italic text-foreground-subtle">
                        Nothing extra to wire up — the prompt rewrite alone should help.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {result.manualSetup.map((item, i) => (
                          <li key={i} className="flex gap-2 text-sm text-foreground-muted">
                            <span className="text-foreground-subtle">{i + 1}.</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  <Section
                    title="Improved prompt"
                    subtitle={`Paste into prompts/${agentSlug}.md, commit, and redeploy`}
                    action={<CopyButton text={result.improvedPrompt} />}
                  >
                    <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-elevated p-3 text-[11px] leading-relaxed text-foreground">
                      {result.improvedPrompt}
                    </pre>
                  </Section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-foreground-subtle">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2 py-1 text-[11px] text-foreground-muted hover:bg-foreground/10"
    >
      <Copy className="h-3 w-3" />
      {copied ? "copied" : "copy"}
    </button>
  );
}
