"use client";

import { createContext, useCallback, useContext, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  dictionaryFor,
  type Dictionary,
  type Locale,
} from "@/lib/i18n/dictionary";

type LocaleContextValue = {
  locale: Locale;
  /** Strings for the active locale. */
  t: Dictionary;
  setLocale: (next: Locale) => void;
  /** True while the server re-renders after a switch. */
  switching: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Seeded from the server so client and server agree on the first render — the
 * value comes from the same cookie the server already read, so there is nothing
 * to reconcile after hydration.
 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      // Server components hold half the copy on a page, so flipping client
      // state alone would translate only that half. refresh() re-renders the
      // server tree with the new cookie, keeping the whole page in one language.
      startTransition(() => router.refresh());
    },
    [router],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: dictionaryFor(locale), setLocale, switching }),
    [locale, setLocale, switching],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}

/** Shorthand for the common case: `const t = useT();` then `t.team.title`. */
export function useT(): Dictionary {
  return useLocale().t;
}
