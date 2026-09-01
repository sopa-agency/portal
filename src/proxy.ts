import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { resolveProjectSlug } from "@/projects/index";

export const config = {
  // Run on everything except static assets and Next internals.
  // Auth routes + /login are checked inside the function so we can early-return.
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.svg$|.*\\.png$|.*\\.jpg$|.*\\.webp$|.*\\.ico$).*)"],
};

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/challenge",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/github",
  // Entrar com carteira. Sem esta linha a rota cai no próprio guarda de sessão
  // e devolve o HTML do /login em vez de JSON — uma porta de entrada trancada
  // por fora, que é como ela nasceu na primeira tentativa.
  "/api/auth/wallet",
  // Unsubscribe links in newsletter emails land here without a session, and
  // the skatehive.app signup checkbox posts to subscribe cross-origin.
  "/api/newsletter/unsubscribe",
  "/api/newsletter/subscribe",
  // Public reads of the curated magazine (current / issues list / issue by
  // number) — the SkateHive website fetches these cross-origin, no session.
  // Curation writes are server actions (separately session-gated), not here.
  "/api/magazine",
  // Public reads of the curated homepage config (current published + draft
  // preview by capability token) — skatehive3.0's /home fetches these
  // cross-origin. Composition is server actions (session-gated), not here.
  "/api/homepage",
  // Server-to-server, gated by NEWSLETTER_API_SECRET inside the route.
  "/api/newsletter/preference",
  // Public read-only feed consumed by the static SOPA site at build time.
  // Tenant-independent (queries Prisma directly) — must not be session-gated.
  "/api/sopa/site-data",
  // Contact form on the public SOPA site posts here (validated + honeypotted
  // inside the route). Static site, so there is no session to gate on.
  "/api/sopa/brief",
  // Timeline coletiva do site público — buscada em runtime, paginada.
  "/api/sopa/feed",
  // Pedido de app: página pública e compartilhável + o endpoint que ela posta.
  // As duas linhas são obrigatórias — sem a segunda o POST cai no guarda de
  // sessão e a pessoa recebe o HTML do /login onde esperava JSON.
  "/app-idea",
  "/api/app-idea",
];

// Páginas públicas de verdade: renderizam SEM a moldura do portal e sem sessão.
// O cookie é removido de propósito, então quem está logado vê exatamente o que
// o visitante vê — é isso que torna o link conferível antes de ser mandado.
const PUBLIC_PAGES = ["/app-idea"];

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
const MACHINE_PATHS = ["/api/scheduler", "/api/reelflip"];

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // 1. Resolve the active project from the host and stamp it onto request headers
  //    so server components / actions can call getActiveProject() without
  //    re-parsing the host themselves.
  const host = req.headers.get("host");

  // CUTOVER: the portals moved to *.sopa.team. Any legacy *.reelflip.com host
  // 308-redirects to its sopa.team equivalent (path + query preserved). The
  // Vercel fallback cron hits the deployment's *.vercel.app URL, not these
  // custom domains, so it keeps running untouched.
  const bareHost = (host ?? "").split(":")[0].toLowerCase();
  if (bareHost === "reelflip.com" || bareHost.endsWith(".reelflip.com")) {
    let target: string;
    if (bareHost === "reelflip.com" || bareHost === "www.reelflip.com") {
      target = "sopa.team";
    } else {
      const label = bareHost.slice(0, -".reelflip.com".length);
      const BRANDS = new Set(["skatehive", "gnars", "vlad", "keepkey", "nogenta", "sopa"]);
      target = BRANDS.has(label) ? `${label}.sopa.team` : "portal.sopa.team";
    }
    const dest = new URL(req.url);
    dest.protocol = "https:";
    dest.host = target;
    dest.port = "";
    return NextResponse.redirect(dest, 308);
  }

  const slug = resolveProjectSlug(host);
  const requestHeaders = new Headers(req.headers);
  // Strip client-supplied trust headers up front — only THIS proxy may set them.
  // Otherwise a request could spoof x-public-page to skip the layout's auth
  // redirect on a portal it shouldn't access.
  requestHeaders.delete("x-public-page");
  requestHeaders.set("x-portal-project", slug);
  // Pathname so the root layout can tell the public /login route apart when
  // deciding whether to render the page or an access screen.
  requestHeaders.set("x-pathname", pathname);

  // Public homepage hosts: "/" serves the landing page (no session gate; the
  // cookie is stripped so even logged-in teammates get the visitor view) and
  // every other path bounces back to "/". Portals live on the subdomains.
  const hostNoPort = (host ?? "").split(":")[0].toLowerCase();
  if (HOME_HOSTS.includes(hostNoPort)) {
    // The homepage's subscribe box posts here; project resolves to reelflip.
    if (pathname.startsWith("/api/newsletter/")) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    // Apex "/" serves the public Reelflip magazine (its OWN route — NOT the
    // shared /home, which stays the portals' page). Cookie stripped = public.
    if (pathname === "/" || pathname === "/reelflip") {
      requestHeaders.delete("cookie");
      // Tell the root layout this is a PUBLIC page so it renders bare (no portal
      // chrome) and skips the auth-redirect — otherwise the stripped cookie ⇒ no
      // session ⇒ redirect to /login ⇒ apex bounces it back ⇒ redirect loop.
      requestHeaders.set("x-public-page", "1");
      const magUrl = req.nextUrl.clone();
      magUrl.pathname = "/reelflip";
      return NextResponse.rewrite(magUrl, { request: { headers: requestHeaders } });
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
    // Uma PÁGINA pública precisa de mais do que passar por aqui: o layout raiz
    // redireciona pra /login em qualquer rota sem sessão que não se declare
    // pública. Sem este carimbo a rota atravessa o proxy e morre no layout.
    if (PUBLIC_PAGES.includes(pathname)) {
      requestHeaders.delete("cookie");
      requestHeaders.set("x-public-page", "1");
    }
    return withProject();
  }
  if (MACHINE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return withProject();
  }

  // 3. AUTHENTICATE only (edge-safe, no DB): a valid signed session passes here.
  //    Per-project AUTHORIZATION (membership + role, DB-backed) is enforced
  //    server-side in the layout/actions via @/lib/team-access.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
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
