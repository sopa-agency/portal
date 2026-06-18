import type { AggregatedColumn } from "@/lib/github-project";

// Read-only aggregated board for the SOPA hub: every portal's Kanban merged by
// status. Cards link out to GitHub; managing happens on each portal's own board.
export function AggregatedKanban({ columns }: { columns: AggregatedColumn[] }) {
  const total = columns.reduce((n, c) => n + c.items.length, 0);
  if (total === 0) {
    return <p className="text-sm text-foreground-muted">Nenhuma tarefa nos boards (ou tokens do GitHub indisponíveis).</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <section key={col.name} className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface">
          <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <span className="truncate text-sm font-semibold text-foreground">{col.name}</span>
            <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 text-[10px] text-foreground-muted">{col.items.length}</span>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {col.items.map((it) => {
              const Card = it.url ? "a" : "div";
              return (
              <Card
                key={it.id}
                {...(it.url ? { href: it.url, target: "_blank", rel: "noopener noreferrer" } : {})}
                className={`block rounded-lg border border-border bg-surface-elevated p-2.5 transition-colors ${it.url ? "hover:border-border-strong" : ""}`}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">{it.board}</span>
                  {it.number ? <span className="text-[10px] text-foreground-faint">#{it.number}</span> : null}
                </div>
                <p className="line-clamp-3 text-sm text-foreground">{it.title}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {it.labels.slice(0, 3).map((l) => (
                    <span key={l.name} className="rounded px-1 text-[9px]" style={{ backgroundColor: `#${l.color}22`, color: `#${l.color}` }}>{l.name}</span>
                  ))}
                  <span className="ml-auto flex -space-x-1.5">
                    {it.assignees.slice(0, 4).map((a) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} className="h-4 w-4 rounded-full border border-surface object-cover" />
                    ))}
                  </span>
                </div>
              </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
