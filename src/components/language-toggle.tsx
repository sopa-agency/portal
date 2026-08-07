"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { LOCALES, LOCALE_LABEL, LOCALE_SHORT } from "@/lib/i18n/dictionary";

/**
 * Two languages, so this is a toggle and not a menu — one click, no popover to
 * aim at. The face shows the language you would switch TO, which is what the
 * click does; showing the current one would read as a status, not a control.
 */
export function LanguageToggle() {
  const { locale, setLocale, switching, t } = useLocale();
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      disabled={switching}
      aria-label={`${t.nav.switchLanguage} — ${LOCALE_LABEL[next]}`}
      title={`${t.nav.switchLanguage}: ${LOCALE_LABEL[next]}`}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-foreground-muted shadow-sm transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-60"
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="text-[11px] font-semibold tabular-nums">{LOCALE_SHORT[next]}</span>
    </button>
  );
}
