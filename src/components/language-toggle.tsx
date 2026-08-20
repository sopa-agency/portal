"use client";

import { FlagBR, FlagUS } from "@/components/flags";
import { useLocale } from "@/components/locale-provider";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dictionary";

/**
 * Language switch.
 *
 * Two languages, so it is a toggle and not a menu — one click, nothing to aim
 * at. The face shows the language you are IN, not the one you would move to: a
 * flag reads as identity, not as a verb, so showing the other country's flag
 * would look like a claim about where you are. The aria-label carries the verb.
 *
 * The flip is a real card turn — two faces on one plane, the back pre-rotated
 * and both with their backsides hidden. It doubles as latency cover: switching
 * re-renders the server tree, and the turn is roughly as long as that takes.
 */
export function LanguageToggle() {
  const { displayLocale, setLocale, switching, t } = useLocale();
  const next = LOCALES[(LOCALES.indexOf(displayLocale) + 1) % LOCALES.length];

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      disabled={switching}
      aria-label={`${t.nav.switchLanguage} — ${LOCALE_LABEL[next]}`}
      title={`${t.nav.switchLanguage}: ${LOCALE_LABEL[next]}`}
      className="lang-toggle flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface shadow-sm transition-colors hover:border-border-strong"
    >
      <span className="lang-flip" data-locale={displayLocale}>
        <span className="lang-face">
          <FlagUS className="h-full w-full" />
        </span>
        <span className="lang-face lang-face-back">
          <FlagBR className="h-full w-full" />
        </span>
      </span>
    </button>
  );
}
