"use client";

import { useEffect, useRef } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

/* eslint-disable @next/next/no-img-element */

// ---------------------------------------------------------------------------
// Theme-aware color sampling — canvas needs concrete colors, the app uses CSS
// vars. Normalise any CSS color through a scratch canvas and re-sample when
// the html.dark class flips.
// ---------------------------------------------------------------------------

function sampleColors() {
  const styles = getComputedStyle(document.documentElement);
  const scratch = document.createElement("canvas").getContext("2d");
  const normalize = (cssValue: string, fallback: string) => {
    if (!scratch) return fallback;
    scratch.fillStyle = fallback;
    try {
      scratch.fillStyle = cssValue.trim() || fallback;
    } catch {
      /* keep fallback */
    }
    return scratch.fillStyle as string;
  };
  return {
    accent: normalize(styles.getPropertyValue("--accent"), "#0891b2"),
    foreground: normalize(styles.getPropertyValue("--foreground"), "#171717"),
  };
}

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const m = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [8, 145, 178];
}

// ---------------------------------------------------------------------------
// Particle-network background with mouse repulsion (React Bits style)
// ---------------------------------------------------------------------------

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let colors = sampleColors();
    let accentRgb = hexToRgb(colors.accent);
    let fgRgb = hexToRgb(colors.foreground);

    // Re-sample colors when the theme class flips.
    const observer = new MutationObserver(() => {
      colors = sampleColors();
      accentRgb = hexToRgb(colors.accent);
      fgRgb = hexToRgb(colors.foreground);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let particles: P[] = [];

    function resize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(110, Math.floor((width * height) / 16000));
      particles = Array.from({ length: count }, (_, i) => ({
        // Deterministic-ish scatter using index hashing keeps SSR happy (this
        // only runs client-side, but avoids layout jumps between resizes).
        x: ((i * 9301 + 49297) % 233280) / 233280 * width,
        y: ((i * 49297 + 9301) % 233280) / 233280 * height,
        vx: (((i * 7919) % 100) / 100 - 0.5) * 0.5,
        vy: (((i * 104729) % 100) / 100 - 0.5) * 0.5,
        r: 1 + ((i * 31) % 100) / 100 * 1.6,
      }));
    }

    const mouse = { x: -9999, y: -9999 };
    function onMove(e: PointerEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
    function onLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }

    const LINK_DIST = 130;
    const MOUSE_DIST = 170;

    let raf = 0;
    function frame() {
      ctx!.clearRect(0, 0, width, height);
      const [ar, ag, ab] = accentRgb;
      const [fr, fg2, fb] = fgRgb;

      for (const p of particles) {
        // Mouse repulsion
        const dxm = p.x - mouse.x;
        const dym = p.y - mouse.y;
        const dm = Math.hypot(dxm, dym);
        if (dm < MOUSE_DIST && dm > 0.001) {
          const force = ((MOUSE_DIST - dm) / MOUSE_DIST) * 0.6;
          p.vx += (dxm / dm) * force;
          p.vy += (dym / dm) * force;
        }
        // Integrate with gentle damping back to drift speed
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed < 0.12) {
          p.vx += (Math.sin(p.y * 0.01) - 0.0) * 0.01;
          p.vy += (Math.cos(p.x * 0.01) - 0.0) * 0.01;
        }
        // Wrap around edges
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }

      // Connections
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > LINK_DIST) continue;
          // Lines near the cursor glow in the accent color
          const mx = (a.x + b.x) / 2 - mouse.x;
          const my = (a.y + b.y) / 2 - mouse.y;
          const nearMouse = Math.hypot(mx, my) < MOUSE_DIST * 1.2;
          const alpha = (1 - d / LINK_DIST) * (nearMouse ? 0.5 : 0.14);
          ctx!.strokeStyle = nearMouse
            ? `rgba(${ar},${ag},${ab},${alpha})`
            : `rgba(${fr},${fg2},${fb},${alpha})`;
          ctx!.lineWidth = nearMouse ? 1.1 : 0.7;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
        }
      }

      // Dots
      for (const p of particles) {
        const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        const near = dm < MOUSE_DIST;
        ctx!.fillStyle = near
          ? `rgba(${ar},${ag},${ab},0.9)`
          : `rgba(${fr},${fg2},${fb},0.35)`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, near ? p.r + 0.6 : p.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    if (!reduceMotion) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerleave", onLeave);
      raf = requestAnimationFrame(frame);
    } else {
      // Static render for reduced motion
      frame();
      cancelAnimationFrame(raf);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}

// ---------------------------------------------------------------------------
// Cursor spotlight — soft accent glow that trails the pointer
// ---------------------------------------------------------------------------

function CursorGlow() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let tx = -9999;
    let ty = -9999;
    let x = tx;
    let y = ty;

    function onMove(e: PointerEvent) {
      tx = e.clientX;
      ty = e.clientY;
    }
    function frame() {
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      el!.style.transform = `translate(${x - 250}px, ${y - 250}px)`;
      raf = requestAnimationFrame(frame);
    }
    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-0 h-[500px] w-[500px] rounded-full opacity-25 blur-3xl"
      style={{
        background:
          "radial-gradient(circle, var(--accent) 0%, transparent 60%)",
        transform: "translate(-9999px, -9999px)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tilt + shine link card
// ---------------------------------------------------------------------------

type LinkItem = {
  title: string;
  subtitle: string;
  href: string;
  emoji: string;
};

function LinkCard({ item, index }: { item: LinkItem; index: number }) {
  const ref = useRef<HTMLAnchorElement | null>(null);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty("--shine-x", `${px * 100}%`);
    el.style.setProperty("--shine-y", `${py * 100}%`);
    el.style.transform = `perspective(700px) rotateX(${(0.5 - py) * 6}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-2px)`;
  }
  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "perspective(700px) rotateX(0deg) rotateY(0deg)";
  }

  return (
    <a
      ref={ref}
      href={item.href}
      target={item.href.startsWith("http") ? "_blank" : undefined}
      rel="noopener noreferrer"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="home-card group relative block overflow-hidden rounded-2xl border border-border bg-surface/70 px-5 py-4 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-accent-border hover:shadow-[0_8px_40px_-12px_var(--accent-bg)]"
      style={{ animationDelay: `${250 + index * 110}ms`, transition: "transform 200ms ease, border-color 300ms, box-shadow 300ms" }}
    >
      {/* shine sweep following the cursor */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(220px circle at var(--shine-x, 50%) var(--shine-y, 50%), var(--accent-bg), transparent 70%)",
        }}
      />
      <span className="relative flex items-center gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-lg">
          {item.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">{item.title}</span>
          <span className="block truncate text-[13px] text-foreground-muted">{item.subtitle}</span>
        </span>
        <span className="text-foreground-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:text-accent">
          →
        </span>
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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

export function HomeClient() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <ParticleField />
      <CursorGlow />
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
          className="home-card mt-5 font-mono text-xl font-bold uppercase tracking-[0.35em] text-foreground"
          style={{ animationDelay: "80ms" }}
        >
          Reelflip
        </h1>
        <p
          className="home-card mt-4 text-center text-[15px] leading-relaxed text-foreground-muted"
          style={{ animationDelay: "160ms" }}
        >
          Não é sobre andar de skate.
          <br />
          <span className="text-accent">É sobre enxergar como quem anda.</span>
        </p>

        {/* Links */}
        <div className="mt-10 w-full space-y-3">
          {LINKS.map((item, i) => (
            <LinkCard key={item.href} item={item} index={i} />
          ))}
        </div>
      </main>

      <footer className="relative z-10 pb-6 text-center text-[12px] text-foreground-faint">
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
