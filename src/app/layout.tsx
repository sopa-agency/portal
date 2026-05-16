import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme-provider";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Skatehive Marketing",
  description: "Internal marketing ops portal for Skatehive.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          {session ? (
            // Authenticated layout: sidebar + main.
            // Middleware guarantees we only get here when a session exists.
            <div className="min-h-screen lg:flex">
              <AppSidebar username={session.username} />
              <main className="min-w-0 flex-1">
                <div className="mx-auto min-h-screen max-w-6xl p-6 md:p-10">
                  {children}
                </div>
              </main>
            </div>
          ) : (
            // Unauthenticated — middleware allows /login through; render bare.
            children
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
