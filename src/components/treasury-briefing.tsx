"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { briefingRuns, type Briefing } from "@/lib/treasury-briefing";
import { useT } from "@/components/locale-provider";

/** Renders a briefing paragraph, lifting the numbers out of the prose. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {briefingRuns(text).map((run, i) =>
        run.num ? (
          <span key={i} className="font-semibold tabular-nums text-accent">
            {run.text}
          </span>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

// Info button in the page header → the treasury state in plain prose, built
// server-side from the same live numbers the cards render.
export function TreasuryBriefingButton({ briefing }: { briefing: Briefing }) {
  const t = useT().treasury.briefing;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // Don't let the page scroll behind the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.title}
        aria-label={t.title}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Info className="h-4 w-4" />
        <span className="hidden sm:inline">{t.action}</span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className="w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t.dialogLabel}
            >
              <header className="flex items-start gap-4 border-b border-border p-5">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold tracking-tight text-foreground">{t.heading}</h2>
                  <p className="mt-1 text-sm text-foreground-muted">
                    <Prose text={briefing.headline} />
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.close}
                  className="shrink-0 rounded-md p-1 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="space-y-5 p-5">
                {briefing.sections.map((s) => (
                  <section key={s.title}>
                    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-foreground-faint">{s.title}</h3>
                    <div className="mt-1.5 space-y-1.5">
                      {s.paragraphs.map((p, idx) => (
                        <p
                          key={idx}
                          className={
                            // Queue entries render as a tight list, not prose.
                            p.startsWith("·")
                              ? "font-mono text-xs text-foreground-muted"
                              : "text-sm leading-relaxed text-foreground-muted"
                          }
                        >
                          <Prose text={p} />
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <footer className="border-t border-border px-5 py-3 text-[11px] text-foreground-faint">
                {t.footer}
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
