import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_DOMAIN, SESSION_MAX_AGE, signSession } from "@/lib/auth";
import { getAccess } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { githubOAuthCreds, exchangeGithubCode, fetchGithubUser, resolveMemberFromGithub, linkGithubIdentity } from "@/lib/oauth-github";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const origin = req.nextUrl.origin;
  const fail = (e: string) => NextResponse.redirect(new URL(`/login?error=${e}`, origin));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookie = req.cookies.get("gh_oauth_state")?.value ?? "";
  const [savedState, nextRaw] = cookie.split("|");
  const next = nextRaw && nextRaw.startsWith("/") ? nextRaw : "/";

  if (!code || !state || !savedState || state !== savedState) return fail("github_state");

  const creds = githubOAuthCreds(project.agent.gatewayEnvPrefix);
  if (!creds) return fail("github_unconfigured");

  const token = await exchangeGithubCode(creds.clientId, creds.clientSecret, code, `${origin}/api/auth/github/callback`);
  if (!token) return fail("github_token");

  const gh = await fetchGithubUser(token);
  if (!gh) return fail("github_user");

  const username = await resolveMemberFromGithub(gh.login, gh.emails);
  if (!username) return fail("github_nomember");

  const access = await getAccess(username, project);
  if (!access.allowed) return fail("github_noaccess");

  // Persist the identity link + login activity (best-effort).
  await linkGithubIdentity(gh.login, username, gh.emails[0] ?? null);
  try {
    const now = new Date();
    await prisma.memberActivity.upsert({
      where: { username },
      update: { lastLoginAt: now, lastLoginProject: project.slug, loginCount: { increment: 1 } },
      create: { username, lastLoginAt: now, lastLoginProject: project.slug, loginCount: 1 },
    });
  } catch {
    /* non-critical */
  }

  const sessionToken = await signSession({ username });
  const res = NextResponse.redirect(new URL(next, origin));
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
  });
  res.cookies.set("gh_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
