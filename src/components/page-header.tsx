import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  status?: string;
  actions?: ReactNode;
  /**
   * Single tight row instead of the stacked block — for pages where the content
   * itself needs the vertical space and the page guide already explains the rest.
   */
  compact?: boolean;
};

export function PageHeader({ eyebrow, title, description, status, actions, compact }: PageHeaderProps) {
  return (
    <header
      className={`flex border-b border-border ${
        compact
          ? "flex-row items-center justify-between gap-3 pb-3"
          : "flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between"
      }`}
    >
      <div className={compact ? "min-w-0" : "space-y-2"}>
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            {eyebrow}
          </p>
        )}
        <div className="flex items-center gap-3">
          <h1
            className={`font-semibold tracking-tight text-foreground ${
              compact ? "truncate text-xl" : "text-2xl"
            }`}
          >
            {title}
          </h1>
          {status && (
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground-muted">
              {status}
            </span>
          )}
        </div>
        {description && (
          <div className="max-w-2xl text-sm text-foreground-muted">{description}</div>
        )}
      </div>
      {actions && (
        // A compact header sits in the same band as FloatingActions, so its own
        // actions have to clear that row. Sized for the widest case — guide +
        // language + theme — since the guide button only exists on some routes.
        <div className={`flex shrink-0 items-center gap-2 ${compact ? "mr-40" : ""}`}>{actions}</div>
      )}
    </header>
  );
}
