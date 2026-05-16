"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import {
  regenerateAllBriefings,
  type BriefingLanguage,
} from "@/app/actions/briefings";

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
      if (!result.ok) {
        const firstError =
          result.results.find((r) => !r.ok)?.error ?? "Regeneration failed";
        setError(firstError);
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
          Regenerate
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Regenerate options"
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
          className="absolute right-0 top-[calc(100%+4px)] z-10 min-w-[200px] overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-lg"
        >
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
