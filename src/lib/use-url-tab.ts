"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Shareable tab/dialog state in the URL query string. Returns the current value
 * (initialised from `?<key>=`, falling back to `fallback`) and a setter.
 *
 * The setter updates React state immediately (instant switch — no server
 * round-trip) AND rewrites the URL with `history.replaceState` so a copied link
 * opens the same tab/dialog. We deliberately avoid next/router here: on the
 * multi-tenant portal the pages are `force-dynamic` behind subdomain rewrites,
 * and `router.replace`+`usePathname` round-trips/clobbers the rewritten path in
 * production. `replaceState` just edits the address bar — robust everywhere.
 *
 * Pass `null`/"" to clear the param (e.g. close a dialog). Each independent
 * selector on a page needs its own `key`. An empty/undefined `key` makes it
 * pure local state (no URL), so it composes as a drop-in for plain useState.
 */
export function useUrlTab(key: string | undefined, fallback = ""): [string, (value: string | null) => void] {
  const searchParams = useSearchParams();
  const [value, setLocal] = useState<string>(() => (key ? searchParams.get(key) : null) ?? fallback);

  const setValue = (next: string | null) => {
    const resolved = next == null || next === "" ? fallback : next;
    setLocal(resolved);
    if (!key || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next == null || next === "") params.delete(key);
    else params.set(key, next);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  };

  return [value, setValue];
}
