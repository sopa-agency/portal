import { CalendarClock } from "lucide-react";

// Small, presentational card indicators shared across surfaces (Kanban board,
// For You, SOPA aggregated, team member dialog). Kept in their own module so
// team-view can use them without a circular import with kanban-board.

/** Priority points as 🔥 (1..5). Compact — shows N flames, nothing if 0. */
export function FirePriority({ value, className = "" }: { value?: number; className?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(value ?? 0)));
  if (!n) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-px leading-none ${className}`}
      title={`Prioridade ${n}/5`}
      aria-label={`Prioridade ${n} de 5`}
    >
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="text-[10px]">🔥</span>
      ))}
    </span>
  );
}

/** Deadline pill (yyyy-mm-dd) with overdue (red) / soon ≤2d (amber) / future tones. */
export function DeadlineChip({ value, className = "" }: { value?: string; className?: string }) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const tone = diff < 0 ? "text-danger" : diff <= 2 ? "text-warning" : "text-foreground-subtle";
  const rel = diff < 0 ? `${-diff}d atrás` : diff === 0 ? "hoje" : diff === 1 ? "amanhã" : `em ${diff}d`;
  const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] font-medium ${tone} ${className}`}
      title={`Deadline ${value} · ${rel}`}
    >
      <CalendarClock className="h-3 w-3 shrink-0" /> {label}
    </span>
  );
}
