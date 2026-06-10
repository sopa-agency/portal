import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { resolveProjectSlug, getProject } from "@/projects/index";

export const config = {
  // Run on everything except static assets and Next internals.
  // Auth routes + /login are checked inside the function so we can early-return.
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.svg$|.*\\.png$|.*\\.jpg$|.*\\.webp$|.*\\.ico$).*)"],
};

const PUBLIC_PATHS = ["/login", "/api/auth/challenge", "/api/auth/login", "/api/auth/logout"];

// Hosts that serve the PUBLIC brand homepage instead of a portal — the apex
// domain. Portals live on subdomains (admin.reelflip.com, gnars.reelflip.com…).
const HOME_HOSTS = (process.env.PORTAL_HOME_HOSTS ?? "reelflip.com,www.reelflip.com")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// Machine-to-machine endpoints that authenticate themselves (e.g. via
// SCHEDULER_TICK_SECRET) rather than a session cookie. The session gate below
// would otherwise 307-redirect these to /login, silently breaking the
// scheduled-post autopublisher (the PM2 worker tick AND the Vercel fallback cron).
const MACHINE_PATHS = ["/api/scheduler"];

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // 1. Resolve the active project from the host and stamp it onto request headers
  //    so server components / actions can call getActiveProject() without
  //    re-parsing the host themselves.
  const host = req.headers.get("host");
  const slug = resolveProjectSlug(host);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-portal-project", slug);

  // Public homepage hosts: "/" serves the landing page (no session gate; the
  // cookie is stripped so even logged-in teammates get the visitor view) and
  // every other path bounces back to "/". Portals live on the subdomains.
  const hostNoPort = (host ?? "").split(":")[0].toLowerCase();
  if (HOME_HOSTS.includes(hostNoPort)) {
    if (pathname === "/" || pathname === "/home") {
      requestHeaders.delete("cookie");
      const homeUrl = req.nextUrl.clone();
      homeUrl.pathname = "/home";
      return NextResponse.rewrite(homeUrl, { request: { headers: requestHeaders } });
    }
    const rootUrl = req.nextUrl.clone();
    rootUrl.pathname = "/";
    rootUrl.search = "";
    return NextResponse.redirect(rootUrl);
  }

  // Helper: forward modified request headers upstream while also allowing
  // further manipulation of the response below.
  const withProject = () =>
    NextResponse.next({
      request: { headers: requestHeaders },
    });

  // 2. Allow public paths through (login page, auth API endpoints) and
  //    self-authenticating machine endpoints (scheduler tick / fallback cron).
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return withProject();
  }
  if (MACHINE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return withProject();
  }

  // 3. Verify session against the active project's allowlist.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const project = getProject(slug);
  const session = await verifySession(token, project);
  if (session) return withProject();

  // 4. Not authenticated — redirect to /login.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  // Still stamp the project header on the redirect response headers so the
  // login page can read the active project name for branding.
  const redirect = NextResponse.redirect(loginUrl);
  redirect.headers.set("x-portal-project", slug);
  return redirect;
}
