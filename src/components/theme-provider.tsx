"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";
const STORAGE_KEY = "portal-theme";

/** Where the reveal circle grows from — viewport coords, usually the button center. */
export type ThemeOrigin = { x: number; y: number };

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme, origin?: ThemeOrigin) => void;
  toggle: (origin?: ThemeOrigin) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Writes the theme to the DOM synchronously — must not wait for an effect,
    since the view transition snapshots the document the moment we return. */
function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* private mode / storage disabled — the theme still applies for this session */
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always start in dark on the server / first paint to match the inline script's
  // initial assumption; the script then promotes to the stored value before hydration.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "dark";
    setThemeState(stored);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Circular reveal: the new theme is clipped to a circle growing out of the
  // toggle button until it covers the farthest corner of the viewport.
  const setTheme = useCallback((next: Theme, origin?: ThemeOrigin) => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduceMotion) {
      applyTheme(next);
      setThemeState(next);
      return;
    }

    // Default origin: roughly where the floating toggle sits (top-right).
    const x = origin?.x ?? window.innerWidth - 40;
    const y = origin?.y ?? 30;
    const radius =
      Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 32;

    document
      .startViewTransition(() => {
        flushSync(() => {
          applyTheme(next);
          setThemeState(next);
        });
      })
      .ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 700,
            easing: "cubic-bezier(0.33, 1, 0.68, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* transition was skipped (e.g. another one started) — theme is already applied */
      });
  }, []);

  const toggle = useCallback(
    (origin?: ThemeOrigin) => {
      setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark", origin);
    },
    [setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

// Inline script — runs BEFORE React hydrates to avoid a flash of wrong theme.
// Use as: <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark')t='dark';if(t==='dark')document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;
