"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Rocket, ChevronDown } from "lucide-react";
import { boostSnap } from "@/app/actions/snap-curation";
import { BOOST_LEVELS, type CurationSnap, type BoostLevel } from "@/lib/snap-curation-shared";

/** Boost split-button (caret → hiveboost levels) for any Hive post — snap or
 * blog. Queues a userbase upvote subset; the Pool B worker paces the release. */
export function HiveBoostButton({ post, onBoosted }: { post: CurationSnap; onBoosted: (b: CurationSnap["boost"]) => void }) {
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

  const doBoost = (level: BoostLevel) =>
    startBusy(async () => {
      setError(null);
      setOpen(false);
      const res = await boostSnap(post.author, post.permlink, level, post.votes);
      if (res.ok) onBoosted({ budget: res.budget, released: 0, status: "active" });
      else setError(res.error);
    });

  return (
    <div ref={ref} className="relative shrink-0">
      <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-accent-border">
        <button
          type="button"
          onClick={() => doBoost("medium")}
          disabled={busy || active}
          className="inline-flex items-center gap-1.5 bg-accent-bg px-2.5 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
          title={active ? "Já impulsionado" : "Impulsionar (Médio)"}
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
        <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-xl">
          <p className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-foreground-subtle">Hiveboost</p>
          {BOOST_LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => doBoost(l.value)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent-bg"
            >
              <span className="flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5 text-accent" /> {l.label}</span>
              <span className="text-[11px] text-foreground-faint">{l.hint}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="absolute right-0 mt-1 w-44 text-right text-[10px] text-danger">{error}</p>}
    </div>
  );
}
