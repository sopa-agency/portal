import type { ReactNode } from "react";
import { Wrench } from "lucide-react";

/**
 * "Not configured yet" page body with a numbered setup walkthrough — shown by
 * routes whose feature lacks config for the active project (Analytics,
 * Treasury, …) instead of hiding the nav item or returning 404.
 */
export function SetupGuide({
  feature,
  intro,
  steps,
}: {
  feature: string;
  intro: string;
  steps: { title: string; body: ReactNode }[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-warning">
          <Wrench className="h-4 w-4 shrink-0" aria-hidden />
          {feature} ainda não está configurado para este portal
        </p>
        <p className="mt-1 text-sm text-foreground-muted">{intro}</p>
      </div>

      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg font-mono text-sm font-bold text-accent">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold text-foreground">{step.title}</p>
              <div className="text-sm leading-relaxed text-foreground-muted">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-[12px] text-foreground-faint">
        Atalho: cola as informações pedidas acima num chat com o Claude no repositório do portal e
        peça para configurar — ele edita o config, faz o deploy e o item passa a funcionar.
      </p>
    </div>
  );
}

/** Inline code chip, theme-aware. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

/** Code block, theme-aware. */
export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-surface-elevated p-4 font-mono text-[12px] leading-relaxed text-foreground">
      {children}
    </pre>
  );
}
