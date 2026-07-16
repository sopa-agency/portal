"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { CalendarExtra } from "@/app/actions/post-creator";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import { SocialBrandIcon } from "@/components/social-brand-icon";

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const day0 = new Date(d); day0.setHours(0, 0, 0, 0);
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const diff = Math.round((day0.getTime() - today0.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const day = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : diff < 0 ? `${-diff}d atrás` : `em ${diff}d`;
  return `${day} · ${time}`;
}

// "Próximos posts" — upcoming scheduled posts from the unified calendar, plus a
// Calendário button that opens the full month grid in a dialog.
export function NextPosts({ events, activeSlug }: { events: CalendarExtra[]; activeSlug: string }) {
  const [open, setOpen] = useState(false);
  // Capture "now" once (Date.now() during render is impure).
  const [now] = useState(() => Date.now());
  const upcoming = events
    .filter((e) => Date.parse(e.when) >= now)
    .sort((a, b) => Date.parse(a.when) - Date.parse(b.when))
    .slice(0, 8);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-accent" /> Próximos posts
        </h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
        >
          <CalendarDays className="h-3.5 w-3.5" /> Calendário
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p className="py-6 text-center text-xs text-foreground-faint">Nada agendado. Agende posts no Lab / Post Creator.</p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2">
              <SocialBrandIcon platform={e.platform} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-muted" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs text-foreground">{e.title || "(sem título)"}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground-faint">
                  <span className="font-medium text-foreground-subtle">{whenLabel(e.when)}</span>
                  {e.projectSlug !== activeSlug && (
                    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 uppercase tracking-wide">{e.projectSlug}</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={() => setOpen(false)}>
          <div className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CalendarDays className="h-4 w-4 text-accent" /> Calendário de posts
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="text-foreground-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ScheduleCalendar events={events} activeSlug={activeSlug} />
          </div>
        </div>
      )}
    </section>
  );
}
