import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { ContentShell } from "@/components/content-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageInfo } from "@/components/page-info";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme-provider";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
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
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);

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
                switchProjects={getSwitcherProjects()
                  .filter((p) => p.allowlist.includes(session.username.toLowerCase()))
                  .map((p) => ({
                    slug: p.slug,
                    subdomain: p.subdomain,
                    name: p.name,
                    logo: p.theme.logo,
                    indent: !!p.switcher?.parent,
                    dividerBefore: !!p.switcher?.dividerBefore,
                  }))}
                hiddenRoutes={project.hiddenRoutes}
                postCreatorEnabled={!!project.postCreator}
                kanbanEnabled={!!project.githubProject}
                aboutEnabled={!!project.about}
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
              />
            </div>
            </PresenceProvider>
          ) : (
            // Unauthenticated — middleware allows /login through; render bare.
            children
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
