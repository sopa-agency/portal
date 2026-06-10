"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Routes that escape the default max-w-6xl reading column and use the full
 * width of the main area (board-style pages).
 */
const FULL_BLEED_ROUTES = ["/kanban"];

export function ContentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  return (
    <div
      className={
        fullBleed
          ? "min-h-screen p-6 md:p-8"
          : "mx-auto min-h-screen max-w-6xl p-6 md:p-10"
      }
    >
      {children}
    </div>
  );
}
