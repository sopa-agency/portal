"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useT } from "@/components/locale-provider";

// ---------------------------------------------------------------------------
// SOPA — deck-style "About" presentation. Services agency (dev + marketing)
// with a hybrid model: paid service + participation by engagement level, across
// 3 tiers. All copy lives in the dictionary (`t.about`); this file only decides
// how the slides look and how you move between them.
//
// It is a scroll deck, so scrolling always works on its own — everything added
// here (the rail, the arrows, the keys) is a shortcut on top of that, never the
// only way through. That keeps the mobile experience honest: no chrome to hunt
// for, just a page that scrolls.
// ---------------------------------------------------------------------------

const TOTAL = 6;

/** Rail entries in slide order — the key picks the label out of the dictionary. */
const RAIL = ["cover", "model", "tiers", "structure", "team", "next"] as const;

/**
 * Slides are addressed by `data-slide` rather than by a ref array: the deck
 * only ever needs them from an effect or a click, and a query keeps the
 * markup and the numbering in one place.
 */
const SLIDE_SELECTOR = "[data-slide]";

function Slide({
  n,
  eyebrow,
  title,
  children,
}: {
  n: number;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      data-slide={n - 1}
      aria-roledescription="slide"
      className="flex min-h-full snap-start snap-always flex-col justify-center px-6 py-16 md:px-16 md:py-12 lg:px-24"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-xs font-semibold tabular-nums text-accent">
            {String(n).padStart(2, "0")} / {String(TOTAL).padStart(2, "0")}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground-subtle">
            {eyebrow}
          </span>
        </div>
        <h2 className="text-balance text-3xl font-bold leading-tight text-foreground md:text-5xl">
          {title}
        </h2>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

/** The three-up card grid used by "the model" and "structure". */
function CardGrid({ cards }: { cards: readonly { k: string; v: string }[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.k}
          className="rounded-xl border border-border bg-surface-elevated p-5 transition-colors hover:border-border-strong"
        >
          <p className="text-sm font-semibold text-accent">{c.k}</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{c.v}</p>
        </div>
      ))}
    </div>
  );
}

export function AboutDeck({ year }: { year: number }) {
  const t = useT().about;
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  // The key handler is bound once; it reads the current slide from here rather
  // than closing over the state it would otherwise go stale on.
  const activeRef = useRef(0);

  const goTo = useCallback((index: number) => {
    const target = scroller.current?.querySelectorAll<HTMLElement>(SLIDE_SELECTOR)[index];
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, []);

  // Which slide owns the middle of the viewport? The margins collapse the root
  // to a horizontal line across the centre, so a slide taller than the screen
  // still reads as "the one you're on" for as long as it covers that line.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.slide);
          if (!Number.isInteger(index)) continue;
          activeRef.current = index;
          setActive(index);
        }
      },
      { root, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const slide of root.querySelectorAll(SLIDE_SELECTOR)) io.observe(slide);
    return () => io.disconnect();
  }, []);

  // Deck keys, because a deck that only answers the mouse feels like a webpage.
  // The scroll container isn't focused by default, so this listens on the
  // window and steps by slide rather than by pixel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = (delta: number) => {
        e.preventDefault();
        goTo(Math.min(TOTAL - 1, Math.max(0, activeRef.current + delta)));
      };
      switch (e.key) {
        case "ArrowDown":
        case "PageDown":
        case " ":
          return step(1);
        case "ArrowUp":
        case "PageUp":
          return step(-1);
        case "Home":
          e.preventDefault();
          return goTo(0);
        case "End":
          e.preventDefault();
          return goTo(TOTAL - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  const onLast = active === TOTAL - 1;
  // The biggest tier's take is the full bar; the others are drawn against it.
  const topTier = Math.max(...t.tiers.items.map((tier) => parseFloat(tier.total)));

  return (
    <div className="relative">
      <div
        ref={scroller}
        className="h-[calc(100dvh-3rem)] snap-y snap-proximity overflow-y-auto scroll-smooth rounded-2xl border border-border bg-surface md:h-[calc(100dvh-4rem)] md:snap-mandatory"
      >
        {/* 1 — Cover */}
        <section
          data-slide={0}
          aria-roledescription="slide"
          className="flex min-h-full snap-start snap-always flex-col justify-center px-6 py-16 md:px-16 md:py-12 lg:px-24"
        >
          <div className="mx-auto w-full max-w-5xl">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
              {t.cover.eyebrow(year)}
            </span>
            <h1 className="mt-4 text-6xl font-black tracking-tight text-foreground md:text-8xl">
              SOPA
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-xl text-foreground-muted md:text-2xl">
              {t.cover.tagline}
            </p>
            <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-foreground-subtle md:text-lg">
              {t.cover.body.before}
              <span className="text-accent">{t.cover.body.accent}</span>
              {t.cover.body.after}
            </p>
            {/* Only worth saying while it's still news — once you've moved, you
                already know how to move. */}
            <p
              className={`mt-10 inline-flex items-center gap-2 text-xs text-foreground-faint transition-opacity duration-500 ${
                active === 0 ? "opacity-100" : "opacity-0"
              }`}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {t.cover.scrollHint}
            </p>
          </div>
        </section>

        {/* 2 — The model */}
        <Slide n={2} eyebrow={t.model.eyebrow} title={t.model.title}>
          <CardGrid cards={t.model.cards} />
        </Slide>

        {/* 3 — Tiers */}
        <Slide n={3} eyebrow={t.tiers.eyebrow} title={t.tiers.title}>
          <div className="grid gap-4 md:grid-cols-3">
            {t.tiers.items.map((tier) => (
              <div
                key={tier.n}
                className="flex flex-col rounded-xl border border-border bg-surface-elevated p-6 transition-colors hover:border-border-strong"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold uppercase tracking-wide text-foreground-subtle">
                    {tier.name}
                  </span>
                  <span className="font-mono text-xs text-foreground-faint">{tier.n}</span>
                </div>
                <p className="mt-3 text-5xl font-black tabular-nums text-accent">{tier.total}</p>
                {/* The bar carries two facts the numbers alone don't: the tier's
                    take relative to the biggest one, and that the ¼ · ¾ cut
                    inside it never moves. */}
                <div
                  role="img"
                  aria-label={t.tiers.barLabel(tier.total, tier.referral, tier.agency)}
                  className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-border"
                >
                  <div
                    className="flex h-full"
                    style={{ width: `${(parseFloat(tier.total) / topTier) * 100}%` }}
                  >
                    <div className="h-full w-1/4 bg-accent/40" />
                    <div className="h-full w-3/4 bg-accent" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
                  <span>
                    <span className="font-semibold text-foreground">{tier.referral}</span>{" "}
                    {t.tiers.referralLabel}
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">{tier.agency}</span>{" "}
                    {t.tiers.agencyLabel}
                  </span>
                </div>
                <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm leading-relaxed text-foreground-muted">
                  <p>{tier.involvement}</p>
                  <p className="text-foreground-subtle">{tier.capture}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm text-foreground-subtle">
            {t.tiers.footnote.before}
            <span className="text-foreground">{t.tiers.footnote.strong}</span>
            {t.tiers.footnote.after}
          </p>
        </Slide>

        {/* 4 — Operating structure */}
        <Slide
          n={4}
          eyebrow={t.structure.eyebrow}
          title={t.structure.title}
        >
          <CardGrid cards={t.structure.cards} />
        </Slide>

        {/* 5 — Team & roles */}
        <Slide n={5} eyebrow={t.team.eyebrow} title={t.team.title}>
          <div className="grid gap-3 md:grid-cols-2">
            {t.team.roles.map((r) => (
              <div
                key={r.role}
                className="flex items-start gap-4 rounded-xl border border-border bg-surface-elevated p-4 transition-colors hover:border-border-strong"
              >
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{r.role}</p>
                  <p className="text-sm text-foreground-muted">{r.scope}</p>
                </div>
              </div>
            ))}
          </div>
        </Slide>

        {/* 6 — Next steps */}
        <Slide n={6} eyebrow={t.next.eyebrow} title={t.next.title}>
          <ol className="space-y-3">
            {t.next.steps.map((step, i) => (
              <li
                key={step}
                className="flex items-start gap-4 rounded-xl border border-border bg-surface-elevated p-4 transition-colors hover:border-border-strong"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg font-mono text-sm font-bold text-accent">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-sm leading-relaxed text-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-foreground-faint">SOPA — {year}</p>
        </Slide>
      </div>

      {/* How far in you are, on the deck's own top edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-px top-px h-0.5 overflow-hidden rounded-t-2xl bg-transparent"
      >
        <div
          className="h-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${((active + 1) / TOTAL) * 100}%` }}
        />
      </div>

      {/* Where you are and what's left, as a rail you can also click. It only
          appears from lg up, where the slides' lg:px-24 has left it a gutter of
          its own — narrower than that it would sit on top of the words, and on
          a phone the thumb already does this job. */}
      <nav
        aria-label={t.nav.position(active + 1, TOTAL)}
        className="absolute right-3 top-1/2 hidden -translate-y-1/2 flex-col items-end gap-1 lg:flex"
      >
        {RAIL.map((key, i) => (
          <button
            key={key}
            type="button"
            onClick={() => goTo(i)}
            aria-label={t.nav.goTo(t.rail[key])}
            aria-current={active === i ? "true" : undefined}
            className="group flex items-center gap-2 rounded-full py-1 pl-3 pr-1"
          >
            <span
              className={`text-[11px] font-medium transition-opacity ${
                active === i
                  ? "text-accent opacity-100"
                  : "text-foreground-subtle opacity-0 group-hover:opacity-100"
              }`}
            >
              {t.rail[key]}
            </span>
            <span
              className={`block rounded-full transition-all ${
                active === i
                  ? "h-1.5 w-5 bg-accent"
                  : "h-1.5 w-1.5 bg-border-strong group-hover:bg-foreground-subtle"
              }`}
            />
          </button>
        ))}
      </nav>

      {/* One click forward, and a way back to the top once there's nothing left
          below — the last slide is where a reader is most likely stuck. Desktop
          only, like the rail: on a phone the slides stack tall enough that a
          floating button would end up parked on top of a paragraph. */}
      <button
        type="button"
        onClick={() => goTo(onLast ? 0 : active + 1)}
        aria-label={onLast ? t.nav.restart : t.nav.next}
        className="absolute bottom-4 left-1/2 hidden h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground-subtle transition-colors hover:border-border-strong hover:text-foreground md:flex"
      >
        {onLast ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
