import { NextRequest, NextResponse } from "next/server";
import { getActiveProject } from "@/projects/index";
import { githubOAuthCreds } from "@/lib/oauth-github";
import { cookieDomainFor } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const creds = githubOAuthCreds(project.agent.gatewayEnvPrefix);
  const origin = req.nextUrl.origin; // the brand the user started from
  // All brands share ONE OAuth App, which allows a single callback URL. Run the
  // handshake through that canonical host, carry `origin` in state, and return
  // the user there afterwards. The session cookie is set on the shared parent
  // domain so it's valid on the brand they come back to. No GitHub change needed
  // to add a new *.reelflip.com brand.
  const authOrigin = process.env.GITHUB_OAUTH_ORIGIN?.trim().replace(/\/$/, "") || origin;
  console.log(`[gh-oauth] start project=${project.slug} prefix=${project.agent.gatewayEnvPrefix} origin=${origin} authOrigin=${authOrigin} hasCreds=${!!creds}`);
  if (!creds) {
    return NextResponse.redirect(new URL("/login?error=github_unconfigured", origin));
  }
  const nextParam = req.nextUrl.searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";
  const state = crypto.randomUUID();

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", creds.clientId);
  authUrl.searchParams.set("redirect_uri", `${authOrigin}/api/auth/github/callback`);
  authUrl.searchParams.set("scope", "read:user user:email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("allow_signup", "false");

  const res = NextResponse.redirect(authUrl);
  // domain-scoped so the callback (on authOrigin) can read it back across the
  // *.reelflip.com subdomains.
  const domain = cookieDomainFor(req.headers.get("host"));
  res.cookies.set("gh_oauth_state", `${state}|${next}|${origin}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    ...(domain ? { domain } : {}),
  });
  return res;
}
