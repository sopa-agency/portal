"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import {
  regenerateAllBriefings,
  getBriefingJobs,
  type BriefingLanguage,
} from "@/app/actions/briefings";

/** Poll enqueued briefing jobs until all settle (done/error) or timeout. */
async function waitForBriefingJobs(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let jobs;
    try {
      jobs = await getBriefingJobs(ids);
    } catch {
      continue;
    }
    if (jobs.length && jobs.every((j) => j.status === "done" || j.status === "error")) {
      return jobs.find((j) => j.status === "error")?.error ?? null;
    }
  }
  return "Timed out waiting for the briefing worker.";
}

export function RegenerateBriefingButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (language: BriefingLanguage) => {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await regenerateAllBriefings(language);
      if (!result.ok && result.jobIds.length === 0) {
        setError(result.results.find((r) => !r.ok)?.error ?? "Regeneration failed");
        return;
      }
      // Enqueued — the Mac worker runs it; poll until the briefings land.
      const err = await waitForBriefingJobs(result.jobIds);
      if (err) {
        setError(err);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div ref={wrapRef} className="relative inline-flex flex-col items-end gap-1">
      <div className="inline-flex">
        <button
          type="button"
          onClick={() => run("pt")}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-l-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Regenerar
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Opções de regeneração"
          className="inline-flex items-center justify-center rounded-r-lg border border-l-0 border-accent-border bg-accent-bg px-1.5 py-1.5 text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-10 min-w-[220px] overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => run("pt")}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition hover:bg-foreground/5 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerar em português
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => run("en")}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition hover:bg-foreground/5 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate in English
          </button>
        </div>
      )}

      {error && (
        <p className="max-w-xs truncate text-right text-[11px] text-red-300" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
