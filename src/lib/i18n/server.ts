import { cookies } from "next/headers";
import { getActiveProject } from "@/projects/index";
import { DEFAULT_LOCALE, LOCALE_COOKIE, dictionaryFor, isLocale, type Locale } from "./dictionary";

/**
 * The locale lives in a cookie rather than in localStorage (where the theme
 * lives) because server components render text too — the Team page title comes
 * out of `page.tsx`. A cookie is the only store both sides can read, so the
 * first HTML already arrives in the right language: no flash, no re-render, and
 * `<html lang>` can be correct from the start.
 */
export async function getLocale(): Promise<Locale> {
  // Portal com idioma travado vence o cookie: a escolha é da marca, não da
  // pessoa. Ver ProjectConfig.forcedLocale. Uma leitura que falhe aqui não
  // pode derrubar a página inteira — cai no cookie, que é o comportamento
  // de sempre.
  const forcado = await getActiveProject()
    .then((p) => p.forcedLocale)
    .catch(() => undefined);
  if (isLocale(forcado)) return forcado;
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Convenience for server components that just want the strings. */
export async function getDictionary() {
  return dictionaryFor(await getLocale());
}
