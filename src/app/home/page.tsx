import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Reelflip",
  description:
    "Não é sobre andar de skate. É sobre enxergar como quem anda. Marca editorial que aplica o olhar do skate à cultura.",
};

/**
 * Public homepage served at the apex domain (reelflip.com) — the proxy
 * rewrites "/" there to this route and bypasses the session gate. Everything
 * else on the apex redirects back here; the portals live on the subdomains.
 */
export default function HomePage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <ThemeToggle />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 md:px-12">
        <span className="font-mono text-sm font-bold uppercase tracking-[0.3em] text-foreground">
          Reelflip
        </span>
        <a
          href="https://instagram.com/reelflip"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          @reelflip
        </a>
      </header>

      {/* Hero */}
      <main className="flex flex-1 items-center px-6 md:px-12">
        <div className="mx-auto w-full max-w-3xl space-y-8 py-20">
          <p className="font-mono text-[12px] uppercase tracking-[0.25em] text-accent">
            Marca editorial
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Não é sobre andar de skate.
            <br />
            <span className="text-foreground-muted">
              É sobre enxergar como quem anda.
            </span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-foreground-muted md:text-lg">
            A Reelflip aplica o olhar do skate à cultura — fala <em>do</em> skate,
            não <em>sobre</em> o skate. Opinião, formato e repertório, toda semana.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <a
              href="https://instagram.com/reelflip"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
            >
              Seguir no Instagram
            </a>
            <a
              href="https://skatehive.app"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border px-5 py-2.5 text-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              Na comunidade SkateHive
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-between px-6 py-5 text-[12px] text-foreground-faint md:px-12">
        <span>© {new Date().getFullYear()} Reelflip</span>
        <a
          href="https://admin.reelflip.com"
          className="transition-colors hover:text-foreground-muted"
        >
          Equipe
        </a>
      </footer>
    </div>
  );
}
