"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ThemeToggle } from "@/components/theme-toggle";
import PixelCard from "@/components/reactbits/PixelCard";

/* eslint-disable @next/next/no-img-element */

// three.js-powered pieces load client-side only, and only on this route.
const PixelBlast = dynamic(() => import("@/components/reactbits/PixelBlast"), { ssr: false });
const GhostCursor = dynamic(() => import("@/components/reactbits/GhostCursor"), { ssr: false });

// ---------------------------------------------------------------------------
// Theme sampling — the canvas/WebGL pieces need concrete colors. Sample the
// accent token and the html.dark flag, and re-sample when the theme flips.
// ---------------------------------------------------------------------------

function readTheme() {
  const isDark = document.documentElement.classList.contains("dark");
  const styles = getComputedStyle(document.documentElement);
  const scratch = document.createElement("canvas").getContext("2d");
  let accent = isDark ? "#22d3ee" : "#0891b2";
  if (scratch) {
    try {
      scratch.fillStyle = styles.getPropertyValue("--accent").trim() || accent;
      accent = scratch.fillStyle as string;
    } catch {
      /* keep fallback */
    }
  }
  return { isDark, accent };
}

function useTheme() {
  const [theme, setTheme] = useState<{ isDark: boolean; accent: string } | null>(null);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

type LinkItem = { title: string; subtitle: string; href: string; emoji: string };

const LINKS: LinkItem[] = [
  {
    title: "Instagram",
    subtitle: "@reelflip — toda a operação, toda semana",
    href: "https://instagram.com/reelflip",
    emoji: "📸",
  },
  {
    title: "SkateHive",
    subtitle: "A comunidade onde a gente publica na chain",
    href: "https://skatehive.app",
    emoji: "🛹",
  },
  {
    title: "Portal da equipe",
    subtitle: "admin.reelflip.com — acesso interno",
    href: "https://admin.reelflip.com",
    emoji: "🔑",
  },
];

// ---------------------------------------------------------------------------
// Page — 8-bit arcade: PixelBlast background, GhostCursor trail, PixelCard
// links. All three take the project accent so light/dark both look right.
// ---------------------------------------------------------------------------

export function HomeClient() {
  const theme = useTheme();

  // Pixel dissolve colors for the cards: neutral steps + accent pop.
  const cardColors = theme
    ? theme.isDark
      ? `#3f3f46,#71717a,${theme.accent}`
      : `#e4e4e7,#a1a1aa,${theme.accent}`
    : undefined;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Background — re-keyed on theme flip so the shader picks up the new color */}
      {theme && (
        <div className="fixed inset-0 z-0 opacity-60" aria-hidden>
          <PixelBlast
            key={theme.isDark ? "dark" : "light"}
            variant="square"
            color={theme.accent}
            pixelSize={5}
            patternScale={2.5}
            patternDensity={1}
            enableRipples
            rippleSpeed={0.5}
            speed={0.5}
            edgeFade={0.3}
          />
        </div>
      )}

      {/* Ghost trail above everything; blend mode adapts per theme */}
      {theme && (
        <GhostCursor
          key={`ghost-${theme.isDark ? "dark" : "light"}`}
          color={theme.accent}
          mixBlendMode={theme.isDark ? "screen" : "multiply"}
          zIndex={40}
        />
      )}

      <ThemeToggle />

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16">
        {/* Avatar */}
        <div className="home-card relative" style={{ animationDelay: "0ms" }}>
          <div className="absolute -inset-1 rounded-full bg-accent-bg blur-md" aria-hidden />
          <img
            src="/projects/reelflip/reelflip-avatar.png"
            alt="Reelflip"
            className="relative h-24 w-24 rounded-full border-2 border-accent-border object-cover"
          />
        </div>

        {/* Wordmark + hero */}
        <h1
          className="home-card mt-5 font-mono text-xl font-bold uppercase tracking-[0.35em]"
          style={{ animationDelay: "80ms" }}
        >
          Reelflip
        </h1>
        <p
          className="home-card mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-foreground-faint"
          style={{ animationDelay: "120ms" }}
        >
          ▸ insert culture ◂
        </p>
        <p
          className="home-card mt-5 text-center text-[15px] leading-relaxed text-foreground-muted"
          style={{ animationDelay: "180ms" }}
        >
          Não é sobre andar de skate.
          <br />
          <span className="text-accent">É sobre enxergar como quem anda.</span>
        </p>

        {/* Links — pixel dissolve on hover */}
        <div className="mt-10 w-full space-y-3">
          {LINKS.map((item, i) => (
            <div key={item.href} className="home-card" style={{ animationDelay: `${280 + i * 110}ms` }}>
              <PixelCard
                colors={cardColors}
                gap={6}
                speed={40}
                noFocus
                className="w-full bg-surface/70 backdrop-blur-md transition-colors hover:border-accent-border"
              >
                <a
                  href={item.href}
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="group relative z-10 flex w-full items-center gap-4 px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-lg">
                    {item.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13px] font-bold uppercase tracking-wider text-foreground">
                      {item.title}
                    </span>
                    <span className="block truncate text-[13px] text-foreground-muted">
                      {item.subtitle}
                    </span>
                  </span>
                  <span className="font-mono text-foreground-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:text-accent">
                    ▶
                  </span>
                </a>
              </PixelCard>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 pb-6 text-center font-mono text-[11px] uppercase tracking-widest text-foreground-faint">
        © {new Date().getFullYear()} Reelflip — marca editorial
      </footer>

      {/* entrance animation */}
      <style>{`
        .home-card {
          opacity: 0;
          animation: home-fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes home-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-card { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
