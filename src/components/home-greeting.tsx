"use client";

// "Bom dia" at 9pm is worse than no greeting at all, so the period of day has
// to come from the viewer's clock — which the server doesn't have.
//
// useSyncExternalStore is what makes that safe: the server (and the first
// hydration pass) render `getServerSnapshot`, so client and server agree on
// the initial HTML, and React swaps in the real period right after. No
// mismatch warning, no flash of the wrong greeting mid-paint.

import { useSyncExternalStore } from "react";
import { useT } from "@/components/locale-provider";

type Period = "morning" | "afternoon" | "evening";

/** Nothing to subscribe to: the hour is read once per mount. Re-rendering a
 *  greeting as the clock ticks past noon is not worth a timer. */
function subscribe() {
  return () => {};
}

function getSnapshot(): Period {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** The page is a *morning* brief — the likeliest period, and the one that
 *  reads least wrong if a viewer has JS off. */
function getServerSnapshot(): Period {
  return "morning";
}

export function HomeGreeting({ username }: { username: string | null }) {
  const t = useT().home.greeting;
  const period = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!username) return <>{t.anonymous}</>;
  return <>{t[period](username)}</>;
}
