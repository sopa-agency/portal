import type { ReactNode } from "react";
import { Wrench } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";

/**
 * "Not configured yet" page body with a numbered setup walkthrough — shown by
 * routes whose feature lacks config for the active project (Analytics,
 * Treasury, …) instead of hiding the nav item or returning 404.
 *
 * Server-only (both call sites are pages), so it reads the dictionary directly
 * rather than through the client context.
 */
export async function SetupGuide({
  feature,
  intro,
  steps,
}: {
  feature: string;
  intro: string;
  steps: { title: string; body: ReactNode }[];
}) {
  const t = await getDictionary();
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-warning">
          <Wrench className="h-4 w-4 shrink-0" aria-hidden />
          {t.ui.setupGuide.notConfigured(feature)}
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
        {t.ui.setupGuide.shortcut}
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
