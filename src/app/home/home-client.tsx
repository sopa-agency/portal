"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import PixelCard from "@/components/reactbits/PixelCard";

/* eslint-disable @next/next/no-img-element */

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
// Newsletter subscribe box — posts to the portal endpoint, which adds the
// email to the Reelflip Paragraph publication (the proxy resolves the apex
// host to the reelflip project).
// ---------------------------------------------------------------------------

function SubscribeBox() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit() {
    const clean = email.trim();
    if (!/.+@.+\..+/.test(clean) || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || !data?.ok) throw new Error("subscribe failed");
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="home-card mt-8 w-full rounded-2xl border border-accent-border bg-accent-bg/60 px-5 py-4 text-center backdrop-blur-md">
        <p className="font-mono text-[13px] font-bold uppercase tracking-wider text-accent">
          ✓ Na lista
        </p>
        <p className="mt-1 text-[13px] text-foreground-muted">
          Até o próximo drop. Sem spam — só o que importa.
        </p>
      </div>
    );
  }

  return (
    <div className="home-card mt-8 w-full" style={{ animationDelay: "640ms" }}>
      <p className="mb-2 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-foreground-subtle">
        ▸ newsletter ◂
      </p>
      <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-surface/70 p-2 backdrop-blur-md transition-colors focus-within:border-accent-border">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="seu@email.com"
          autoComplete="email"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={state === "sending" || !/.+@.+\..+/.test(email.trim())}
          className="shrink-0 rounded-xl bg-accent-bg px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {state === "sending" ? "…" : "Assinar"}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-foreground-faint">
        {state === "error"
          ? "Não rolou — confere o email e tenta de novo."
          : "O olhar do skate na sua inbox. Cancele quando quiser."}
      </p>
    </div>
  );
}

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

        {/* Newsletter subscribe */}
        <SubscribeBox />

        {/* Links — pixel dissolve on hover */}
        <div className="mt-8 w-full space-y-3">
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
