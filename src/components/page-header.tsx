import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  status?: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, status, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            {eyebrow}
          </p>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
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
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
