"use client";

// Interactive planning calendar for a campaign's assets. Each asset can be
// placed on a day (scheduledFor); the month grid highlights them, colored by
// kind. Unscheduled assets sit in a tray — click one to "arm" it, then click a
// day to place it. The × on a chip clears its date. Copy is PT-BR.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, CalendarDays } from "lucide-react";
import type { CampaignDocumentKind } from "@/lib/campaign-kind";

export type CalendarAsset = {
  id: string;
  name: string;
  kind: CampaignDocumentKind;
  tone: string;
  scheduledFor: Date | null;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isoAtNoon = (d: Date) => {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x.toISOString();
};

export function CampaignCalendar({
  assets,
  onSchedule,
  onOpen,
  busy,
}: {
  assets: CalendarAsset[];
  onSchedule: (id: string, iso: string | null) => void;
  onOpen: (id: string) => void;
  busy?: boolean;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [armed, setArmed] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m: Record<string, CalendarAsset[]> = {};
    for (const a of assets) if (a.scheduledFor) (m[dayKey(new Date(a.scheduledFor))] ??= []).push(a);
    return m;
  }, [assets]);

  const unscheduled = assets.filter((a) => !a.scheduledFor);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const todayKey = dayKey(new Date());
  const monthLabel = month.toLocaleString("pt-BR", { month: "long", year: "numeric" });

  const placeOn = (d: Date) => {
    if (!armed) return;
    onSchedule(armed, isoAtNoon(d));
    setArmed(null);
  };

  return (
    <div className="space-y-3">
      {/* Unscheduled tray */}
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Sem data ({unscheduled.length})
          {armed && <span className="ml-1 normal-case text-accent">· clique num dia pra agendar</span>}
        </div>
        {unscheduled.length === 0 ? (
          <p className="text-[11px] text-foreground-faint">Tudo agendado. 🎉</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setArmed(armed === a.id ? null : a.id)}
                className={`rounded-md border px-2 py-1 text-[11px] transition ${
                  armed === a.id
                    ? "border-accent-border bg-accent-bg text-accent"
                    : "border-border bg-surface-elevated hover:border-border-strong"
                }`}
              >
                <span className={a.tone}>●</span>{" "}
                <span className={armed === a.id ? "text-accent" : "text-foreground-muted"}>{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Month grid */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold capitalize text-foreground">
            <CalendarDays className="h-4 w-4 text-accent" /> {monthLabel}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="rounded-md border border-border p-1 text-foreground-muted transition hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted transition hover:text-foreground"
            >
              hoje
            </button>
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="rounded-md border border-border p-1 text-foreground-muted transition hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="pb-1 text-center text-[10px] font-medium text-foreground-faint">
              {wd}
            </div>
          ))}
          {days.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === month.getMonth();
            const dayAssets = byDay[key] ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                onClick={() => placeOn(d)}
                className={`min-h-[70px] rounded-md border p-1 ${
                  inMonth ? "border-border bg-surface-elevated" : "border-transparent opacity-40"
                } ${armed && inMonth ? "cursor-pointer hover:border-accent-border" : ""}`}
              >
                <div className={`mb-0.5 text-[10px] ${isToday ? "font-bold text-accent" : "text-foreground-faint"}`}>
                  {d.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayAssets.map((a) => (
                    <div key={a.id} className="group flex items-center gap-1 rounded bg-surface px-1 py-0.5 text-[10px]">
                      <span className={a.tone}>●</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(a.id);
                        }}
                        className="min-w-0 flex-1 truncate text-left text-foreground-muted transition hover:text-foreground"
                      >
                        {a.name}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSchedule(a.id, null);
                        }}
                        className="text-foreground-faint opacity-0 transition hover:text-danger group-hover:opacity-100"
                        aria-label="Remover data"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {busy && <p className="text-[11px] text-foreground-faint">salvando…</p>}
    </div>
  );
}
