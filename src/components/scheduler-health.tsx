import { getSchedulerHealth } from "@/lib/scheduler-lease";

// Home-page indicator for the scheduler heartbeat. The Mac worker is the primary
// publisher (residential IP); the Vercel cron is the fallback. If the Mac stops,
// nobody notices until posts stop going out — so surface it: green when the Mac
// is ticking, amber when it's down and the Vercel fallback is carrying it.

function fmtAgo(min: number): string {
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}m`;
  if (min < 1440) return `há ${Math.round(min / 60)}h`;
  return `há ${Math.round(min / 1440)}d`;
}

export async function SchedulerHealth() {
  const h = await getSchedulerHealth().catch(() => null);
  if (!h) return null;

  const alive = h.macAlive;
  const never = h.agoMinutes == null;
  const tone = alive ? "ok" : never ? "faint" : "warn";
  const label = alive
    ? `Mac ativo · último tick ${fmtAgo(h.agoMinutes!)}`
    : never
      ? "sem tick registrado · Vercel cobrindo"
      : `Mac fora ${fmtAgo(h.agoMinutes!)} · Vercel cobrindo (fallback)`;

  const dot =
    tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-foreground-faint";
  const text =
    tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground-subtle";

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs">
      <span className={`relative flex h-2 w-2 shrink-0`}>
        {alive && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      <span className="font-medium text-foreground-muted">Agendador</span>
      <span className={text}>{label}</span>
    </div>
  );
}
