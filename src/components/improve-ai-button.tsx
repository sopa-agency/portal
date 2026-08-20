"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, ChevronDown, Loader2 } from "lucide-react";

/**
 * Reusable "Improve with AI" split button: primary action runs with the default
 * prompt; the down-arrow opens a menu with "Melhorar agora" and "Editar prompt…"
 * (lets the user tweak the instruction before running). Use everywhere an AI
 * improve action exists. `onRun(instruction?)` runs — instruction undefined =
 * default.
 */
export function ImproveAiButton({
  onRun,
  busy,
  defaultInstruction,
  label = "Improve with AI",
}: {
  onRun: (instruction?: string) => void;
  busy?: boolean;
  defaultInstruction: string;
  label?: string;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState(defaultInstruction);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(false);
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        disabled={busy}
        onClick={() => onRun()}
        className="flex items-center gap-1.5 rounded-l-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {label}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => { setEditing(false); setMenu((o) => !o); }}
        aria-label="Opções de IA"
        className="rounded-r-lg border border-l-0 border-accent-border bg-accent-bg px-1.5 text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menu && !editing && (
        <div className="absolute right-0 top-[calc(100%+0.25rem)] z-50 w-44 rounded-lg border border-border bg-surface-elevated p-1 shadow-lg">
          <button type="button" onClick={() => { setMenu(false); onRun(); }} className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-foreground/5">
            Melhorar agora
          </button>
          <button type="button" onClick={() => setEditing(true)} className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-foreground/5">
            Editar prompt…
          </button>
        </div>
      )}

      {menu && editing && (
        <div className="absolute right-0 top-[calc(100%+0.25rem)] z-50 w-72 space-y-2 rounded-lg border border-border bg-surface-elevated p-2 shadow-lg">
          <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Instrução pra IA</span>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
          />
          <div className="flex gap-1.5">
            <button type="button" onClick={() => { setMenu(false); setEditing(false); onRun(instruction); }} className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground hover:opacity-90">
              Rodar
            </button>
            <button type="button" onClick={() => setInstruction(defaultInstruction)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted hover:text-foreground">
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
