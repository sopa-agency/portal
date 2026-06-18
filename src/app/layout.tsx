import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandK } from "@/components/command-k";
import { ContentShell } from "@/components/content-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageInfo } from "@/components/page-info";
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
  return {
    title: `${project.name} Portal`,
    description: project.description,
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
  // The /login route always renders (so users can sign in / switch accounts).
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isLoginRoute = pathname === "/login";
  // Authorization. Redirect (not conditional render) so an unauthorized page's
  // Server Components never execute into the RSC payload. Middleware already
  // bounces the fully-unauthenticated; this also covers authenticated-without-
  // access-to-this-portal.
  if (!session && !isLoginRoute) {
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

  // Portals the user can switch to (shared by the sidebar + ⌘K palette).
  const switchProjects = session
    ? getSwitcherProjects()
        .filter((p) => p.allowlist.includes(session.username.toLowerCase()))
        .map((p) => ({
          slug: p.slug,
          subdomain: p.subdomain,
          name: p.name,
          logo: p.theme.logo,
          indent: !!p.switcher?.parent,
          dividerBefore: !!p.switcher?.dividerBefore,
        }))
    : [];
  // Enabled routes for the active portal (for ⌘K). Mirrors the sidebar's gating.
  const navItems = (
    [
      { href: "/", label: "Home", on: true },
      { href: "/post-creator", label: "Post Creator", on: !!project.postCreator },
      { href: "/lab", label: "Lab", on: !!project.lab },
      { href: "/zine", label: "Zine Studio", on: !!project.zineStudio },
      { href: "/marketing-suggestions", label: "Post Suggestions", on: true },
      { href: "/campaign-creator", label: "Campaign Creator", on: true },
      { href: "/userbase", label: "Userbase", on: true },
      { href: "/brain", label: "Brain", on: true },
      { href: "/analytics", label: "Analytics", on: true },
      { href: "/kanban", label: "Kanban", on: !!project.githubProject || !!project.kanbanAggregate },
      { href: "/about", label: "About", on: !!project.about },
      { href: "/treasury", label: "Treasury", on: true },
      { href: "/org-chart", label: "Org Chart", on: !!project.orgChart },
      { href: "/reunioes", label: "Reuniões", on: !!project.meetings },
      { href: "/portfolio", label: "Portfolio", on: !!project.portfolio },
      { href: "/team", label: "Team", on: true },
      { href: "/settings", label: "Settings", on: true },
    ] as const
  )
    .filter((r) => r.on && !project.hiddenRoutes?.includes(r.href))
    .map(({ href, label }) => ({ href, label }));

  return (
    <html
      lang="en"
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
          {session ? (
            // Authenticated layout: sidebar + main, with live team presence.
            <PresenceProvider username={session.username} projectSlug={project.slug}>
            <div className="min-h-screen lg:flex">
              <AppSidebar
                username={session.username}
                projectName={project.name}
                projectLogo={project.theme.logo}
                currentSlug={project.slug}
                switchProjects={switchProjects}
                hiddenRoutes={project.hiddenRoutes}
                postCreatorEnabled={!!project.postCreator}
                kanbanEnabled={!!project.githubProject || !!project.kanbanAggregate}
                aboutEnabled={!!project.about}
                orgChartEnabled={!!project.orgChart}
                portfolioEnabled={!!project.portfolio}
                labEnabled={!!project.lab}
                zineEnabled={!!project.zineStudio}
                meetingsEnabled={!!project.meetings}
              />
              <ThemeToggle />
              <PageInfo />
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
            </PresenceProvider>
          ) : (
            // Only reached on the public /login route (the guard above redirects
            // every other unauthorized request before this renders).
            children
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
