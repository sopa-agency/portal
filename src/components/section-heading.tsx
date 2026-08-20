import type { ReactNode } from "react";

// One heading style for every treasury section, so the page reads as one system:
// title, a single line saying what it's for, and an optional right-side value.
export function SectionHeading({
  title,
  hint,
  aside,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-foreground-subtle">{hint}</p>}
      </div>
      {aside && <div className="shrink-0 text-sm tabular-nums text-foreground-muted">{aside}</div>}
    </div>
  );
}

/** A titled block: standardized heading + its content. */
export function Section({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading title={title} hint={hint} aside={aside} />
      {children}
    </section>
  );
}
