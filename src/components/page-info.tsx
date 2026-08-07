"use client";

import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import { Info, X, BookOpen } from "lucide-react";
import { guideForPath } from "@/lib/page-guides";

/**
 * Floating "how does this page work?" button, pinned next to the theme
 * toggle. Opens a fullscreen guide for the current route with explanatory
 * text and screenshots of the components.
 */
export function PageInfo() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const guide = guideForPath(pathname);

  // Close on route change and on Escape; lock body scroll while open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!guide) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`How the ${guide.title} page works`}
        title="How this page works"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-foreground-muted shadow-sm transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Info className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 overflow-y-auto bg-background"
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-bg text-accent">
                  <BookOpen className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-accent">Guide</p>
                  <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
                    {guide.title}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close guide"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="mx-auto max-w-3xl space-y-10 px-6 py-8 pb-16">
            <p className="text-base leading-relaxed text-foreground-muted">{guide.tagline}</p>

            {guide.sections.map((section) => (
              <section key={section.heading} className="space-y-3">
                <h3 className="text-base font-semibold text-foreground">{section.heading}</h3>
                <p className="text-sm leading-relaxed text-foreground-muted">{section.body}</p>
                {section.image && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={section.image}
                    alt={section.imageAlt ?? section.heading}
                    loading="lazy"
                    className="w-full rounded-xl border border-border shadow-sm"
                  />
                )}
              </section>
            ))}

            <p className="border-t border-border pt-6 text-xs text-foreground-subtle">
              Still stuck? Ask the agent in the chat bubble at the bottom-right — it can see
              the page you&apos;re on.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
