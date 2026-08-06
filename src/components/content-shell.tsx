"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Routes that escape the default max-w-6xl reading column and use the full
 * width of the main area (board-style pages).
 */
const FULL_BLEED_ROUTES = ["/kanban", "/about", "/org-chart", "/lab", "/zine", "/reunioes"];

/**
 * Routes that use the wide dashboard canvas (the Split Desk home design caps
 * at 1760px) instead of the reading column.
 */
const WIDE_ROUTES = ["/", "/treasury"];

export function ContentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const wide = WIDE_ROUTES.includes(pathname);
  return (
    <div
      className={
        fullBleed
          ? "min-h-screen p-6 md:p-8"
          : wide
            ? "mx-auto min-h-screen max-w-[1760px] p-6 md:p-8"
            : "mx-auto min-h-screen max-w-6xl p-6 md:p-10"
      }
    >
      {children}
    </div>
  );
}
