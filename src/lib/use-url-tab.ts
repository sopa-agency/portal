"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shareable tab/dialog state in the URL query string. Returns the current value
 * (from `?<key>=`, falling back to `fallback`) and a setter that updates the URL
 * with router.replace (no history spam, no scroll jump) — so a copied link opens
 * the same tab/dialog. Each independent selector on a page needs its own `key`.
 * Pass `null` to the setter to clear the param (e.g. close a dialog).
 */
export function useUrlTab(key: string, fallback = ""): [string, (value: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(key) ?? fallback;

  const setValue = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === null || next === "") params.delete(key);
    else params.set(key, next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return [value, setValue];
}
