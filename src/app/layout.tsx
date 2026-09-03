import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { WalletProvider } from "@/components/wallet-provider";
import { isTrailParticipant } from "@/lib/farcaster-trail-config";
import { CommandK } from "@/components/command-k";
import { ContentShell } from "@/components/content-shell";
import { FloatingActions } from "@/components/floating-actions";
import { LocaleProvider } from "@/components/locale-provider";
import { getLocale } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { hiveAvatarUrl, accessiblePortalSlugs } from "@/lib/team-roster";
import { dictionaryFor } from "@/lib/i18n/dictionary";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme-provider";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getAccess } from "@/lib/team-access";
import { getActiveProject, getSwitcherProjects } from "@/projects/index";
import { FloatingAgentChat } from "@/components/floating-agent-chat";
import { PresenceProvider } from "@/components/presence";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const project = await getActiveProject();
  // Each portal's browser favicon is its own logo (favicon override if set).
  const icon = project.theme.favicon ?? project.theme.logo;
  return {
    title: `${project.name} Portal`,
    description: project.description,
    icons: { icon, shortcut: icon, apple: icon },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  // Authorization point (middleware only authenticates). Three states:
  //   authed + access  → full app
  //   authed, NO access → "no access to this portal" screen (no content leak)
  //   not authed        → render children (the /login page)
  const authed = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  const access = authed ? await getAccess(authed.username, project) : null;
  const session = access?.allowed ? authed : null;
  // Avatar state was resolved at login and parked in the DB precisely so this
  // layout — which runs on every page — reads it locally instead of calling
  // Hive on the critical path. Null (never resolved / lookup failed) falls back
  // to initials rather than risking Hive's generic silhouette.
  const viewerHasAvatar = session
    ? await prisma.memberActivity
        .findUnique({ where: { username: session.username }, select: { hasAvatar: true } })
        .then((r) => r?.hasAvatar ?? false)
        .catch(() => false)
    : false;
  // The /login route always renders (so users can sign in / switch accounts).
  const locale = await getLocale();
  const t = dictionaryFor(locale);
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isLoginRoute = pathname === "/login";
  // Public apex page (reelflip.com magazine): the proxy stamps x-public-page and
  // strips the cookie, so it must render bare without the auth-redirect.
  const isPublicPage = hdrs.get("x-public-page") === "1";
  // Authorization. Redirect (not conditional render) so an unauthorized page's
  // Server Components never execute into the RSC payload. Middleware already
  // bounces the fully-unauthenticated; this also covers authenticated-without-
  // access-to-this-portal.
  if (!session && !isLoginRoute && !isPublicPage) {
    redirect(`/login?next=${encodeURIComponent(pathname || "/")}`);
  }

  // Build per-project accent CSS-var overrides that layer on top of the base
  // token system without breaking light/dark mode. Only the accent family is
  // overridden — all other tokens remain from globals.css.
  const themeOverrides = `
    :root {
      --accent: ${project.theme.accentLight};
      --accent-bg: ${project.theme.accentBgLight};
      --accent-border: ${project.theme.accentBorderLight};
    }
    .dark {
      --accent: ${project.theme.accentDark};
      --accent-bg: ${project.theme.accentBgDark};
      --accent-border: ${project.theme.accentBorderDark};
    }
  `;

  // Portais para os quais a pessoa pode trocar (barra lateral + paleta ⌘K).
  //
  // Vem do BANCO, pela mesma regra que decide quem entra. Filtrar pelo
  // `allowlist` do config dava o pior dos mundos: quem foi adicionado pelo
  // painel entrava digitando a URL, mas não via o menu para trocar de portal —
  // tinha o acesso e não tinha a porta.
  const reachable = session ? await accessiblePortalSlugs(session.username) : null;
  const switchProjects = session
    ? getSwitcherProjects()
        .filter((p) => reachable?.has(p.slug) ?? false)
        .map((p) => ({
          slug: p.slug,
          subdomain: p.subdomain,
          name: p.name,
          logo: p.theme.logo,
          indent: !!p.switcher?.parent,
          dividerBefore: !!p.switcher?.dividerBefore,
        }))
    : [];
  // A carteira que a pessoa cadastrou no Team.
  //
  // Serve para o perfil da barra lateral dizer se a carteira CONECTADA no
  // navegador é a mesma que está no cadastro. Sem essa comparação, "conectado"
  // é só um endereço na tela: a pessoa pode estar operando com a conta errada da
  // MetaMask e o portal não teria como avisar.
  //
  // Contato é por PESSOA, não por portal — a mesma carteira vale em qualquer um
  // deles — então a busca não filtra por projectSlug.
  const registeredWallet = session
    ? await prisma.teamMemberContact
        .findFirst({
          where: { username: session.username, label: "Wallet" },
          select: { value: true },
        })
        .then((r) => r?.value ?? null)
        .catch(() => null)
    : null;

  // Enabled routes for the active portal (for ⌘K). Mirrors the sidebar's gating.
  const navItems = (
    [
      { href: "/", label: t.nav.items.home, on: true },
      { href: "/post-creator", label: t.nav.items.postCreator, on: !!project.postCreator },
      { href: "/lab", label: t.nav.items.lab, on: !!project.lab },
      { href: "/tiktok", label: t.nav.items.tiktok, on: !!project.tiktok },
      { href: "/zine", label: t.nav.items.zine, on: !!project.zineStudio },
      { href: "/marketing-suggestions", label: t.nav.items.postSuggestions, on: true },
      { href: "/campaign-creator", label: t.nav.items.campaignCreator, on: true },
      { href: "/userbase", label: t.nav.items.userbase, on: true },
      { href: "/settings?tab=brain", label: t.nav.items.brain, on: !project.hiddenRoutes?.includes("/brain") },
      { href: "/analytics", label: t.nav.items.analytics, on: true },
      { href: "/kanban", label: t.nav.items.kanban, on: !!project.githubProject || !!project.kanbanAggregate },
      { href: "/magazine", label: t.nav.items.magazine, on: !!project.magazine },
      { href: "/homepage", label: t.nav.items.homepage, on: !!project.homepage },
      { href: "/about", label: t.nav.items.about, on: !!project.about },
      { href: "/treasury", label: t.nav.items.treasury, on: true },
      { href: "/org-chart", label: t.nav.items.orgChart, on: !!project.orgChart },
      { href: "/reunioes", label: t.nav.items.meetings, on: !!project.meetings },
      { href: "/portfolio", label: t.nav.items.portfolio, on: !!project.portfolio },
      { href: "/burndown", label: t.nav.items.burnDown, on: !!project.burnDown },
      { href: "/team", label: t.nav.items.team, on: true },
      { href: "/settings", label: t.nav.items.settings, on: true },
    ]
  )
    .filter((r) => r.on && !project.hiddenRoutes?.includes(r.href))
    .map(({ href, label }) => ({ href, label }));

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Flash-of-wrong-theme prevention must run before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Per-project accent token overrides — injected after globals.css. */}
        <style dangerouslySetInnerHTML={{ __html: themeOverrides }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          <LocaleProvider locale={locale}>
          {session ? (
            // Authenticated layout: sidebar + main, with live team presence.
            <PresenceProvider username={session.username} projectSlug={project.slug}>
            <WalletProvider>
            <div className="min-h-screen lg:flex">
              <AppSidebar
                username={session.username}
                avatarUrl={viewerHasAvatar ? hiveAvatarUrl(session.username) : null}
                registeredWallet={registeredWallet}
                projectName={project.name}
                projectLogo={project.theme.logo}
                currentSlug={project.slug}
                switchProjects={switchProjects}
                hiddenRoutes={project.hiddenRoutes}
                postCreatorEnabled={!!project.postCreator}
                kanbanEnabled={!!project.githubProject || !!project.kanbanAggregate}
                magazineEnabled={!!project.magazine}
                homepageEnabled={!!project.homepage}
                aboutEnabled={!!project.about}
                orgChartEnabled={!!project.orgChart}
                portfolioEnabled={!!project.portfolio}
                burnDownEnabled={!!project.burnDown}
                chatEnabled={!!project.chat}
                labEnabled={!!project.lab}
                zineEnabled={!!project.zineStudio}
                meetingsEnabled={!!project.meetings}
                tiktokEnabled={!!project.tiktok}
                farcasterTrailEnabled={isTrailParticipant(project.slug)}
              />
              <FloatingActions />
              <main className="min-w-0 flex-1">
                <ContentShell>{children}</ContentShell>
              </main>
              <FloatingAgentChat
                projectSlug={project.slug}
                agentId={project.agent.id}
                agentName={project.agent.displayName}
                agentEmoji={project.agent.emoji}
                greeting={project.agent.greeting}
                logo={project.theme.logo}
                kanbanEnabled={!!project.githubProject || !!project.kanbanAggregate}
              />
              <CommandK navItems={navItems} portals={switchProjects} currentSlug={project.slug} />
            </div>
            </WalletProvider>
            </PresenceProvider>
          ) : (
            // Only reached on the public /login route (the guard above redirects
            // every other unauthorized request before this renders).
            children
          )}
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
