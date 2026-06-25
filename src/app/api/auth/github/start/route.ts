import { NextRequest, NextResponse } from "next/server";
import { getActiveProject } from "@/projects/index";
import { githubOAuthCreds } from "@/lib/oauth-github";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const creds = githubOAuthCreds(project.agent.gatewayEnvPrefix);
  const origin = req.nextUrl.origin;
  console.log(`[gh-oauth] start project=${project.slug} prefix=${project.agent.gatewayEnvPrefix} origin=${origin} hasCreds=${!!creds}`);
  if (!creds) {
    return NextResponse.redirect(new URL("/login?error=github_unconfigured", origin));
  }
  const nextParam = req.nextUrl.searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";
  const state = crypto.randomUUID();

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", creds.clientId);
  authUrl.searchParams.set("redirect_uri", `${origin}/api/auth/github/callback`);
  authUrl.searchParams.set("scope", "read:user user:email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("allow_signup", "false");

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gh_oauth_state", `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
