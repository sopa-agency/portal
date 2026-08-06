"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

/** Floating theme switch, pinned to the top-right of the platform. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="fixed right-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-foreground-muted shadow-sm transition-colors hover:border-border-strong hover:text-foreground"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
