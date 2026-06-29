"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Rocket, ChevronDown, Zap } from "lucide-react";
import { boostSnap } from "@/app/actions/snap-curation";
import { boostLevelsFor, type CurationSnap, type BoostLevel, type BoostKind } from "@/lib/snap-curation-shared";

/** Boost split-button (caret → hiveboost levels) for any Hive post — snap or
 * blog. Queues a userbase upvote subset; the Pool B worker paces the release.
 * `kind="blog"` uses the bigger mag-post tiers (strong = up to 200). */
export function HiveBoostButton({ post, onBoosted, kind = "snap" }: { post: CurationSnap; onBoosted: (b: CurationSnap["boost"]) => void; kind?: BoostKind }) {
  const levels = boostLevelsFor(kind);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = post.boost?.status === "active";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const doBoost = (level: BoostLevel, mode: "organic" | "direct" = "organic") =>
    startBusy(async () => {
      setError(null);
      setOpen(false);
      const res = await boostSnap(post.author, post.permlink, level, post.votes, kind, mode);
      if (res.ok) onBoosted({ budget: res.budget, released: 0, status: "active" });
      else setError(res.error);
    });

  return (
    <div ref={ref} className="relative shrink-0">
      <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-accent-border">
        <button
          type="button"
          onClick={() => doBoost("medium", "organic")}
          disabled={busy || active}
          className="inline-flex items-center gap-1.5 bg-accent-bg px-2.5 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
          title={active ? "Já impulsionado" : "Impulsionar (Orgânico · Médio)"}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {active ? "Impulsionando" : "Boost"}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy || active}
          aria-label="Opções de boost"
          aria-expanded={open}
          className="border-l border-accent-border bg-accent-bg px-1.5 text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-xl">
          {([
            { mode: "organic", label: "Organic boost", hint: "acompanha os likes reais" },
            { mode: "direct", label: "Direct boost", hint: "intervalos aleatórios, sem depender de likes" },
          ] as const).map((section) => (
            <div key={section.mode} className="border-b border-border last:border-b-0">
              <div className="px-3 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">{section.label}</p>
                <p className="text-[10px] text-foreground-faint">{section.hint}</p>
              </div>
              {levels.map((l) => (
                <button
                  key={`${section.mode}-${l.value}`}
                  type="button"
                  onClick={() => doBoost(l.value, section.mode)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent-bg"
                >
                  <span className="flex items-center gap-1.5">
                    {section.mode === "direct" ? <Zap className="h-3.5 w-3.5 text-amber-400" /> : <Rocket className="h-3.5 w-3.5 text-accent" />}
                    {l.label}
                  </span>
                  <span className="text-[11px] text-foreground-faint">{l.hint}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {error && <p className="absolute right-0 mt-1 w-44 text-right text-[10px] text-danger">{error}</p>}
    </div>
  );
}
