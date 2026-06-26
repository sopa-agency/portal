import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, cookieDomainFor } from "@/lib/auth";
import { getAccess } from "@/lib/team-access";
import { getProject, resolveProjectSlug } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { githubOAuthCreds, exchangeGithubCode, fetchGithubUser, resolveMemberFromGithub, linkGithubIdentity } from "@/lib/oauth-github";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const callbackOrigin = req.nextUrl.origin; // the canonical host this landed on

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookie = req.cookies.get("gh_oauth_state")?.value ?? "";
  const [savedState, nextRaw, originRaw] = cookie.split("|");
  const next = nextRaw && nextRaw.startsWith("/") ? nextRaw : "/";
  // The brand the user started from — where we send them back and check access.
  const returnOrigin = originRaw && /^https?:\/\//.test(originRaw) ? originRaw : callbackOrigin;
  const returnHost = (() => { try { return new URL(returnOrigin).host; } catch { return ""; } })();
  const project = getProject(resolveProjectSlug(returnHost));

  const fail = (e: string) => {
    console.error(`[gh-oauth] callback FAIL=${e} project=${project.slug} return=${returnOrigin}`);
    return NextResponse.redirect(new URL(`/login?error=${e}`, returnOrigin));
  };

  if (!code || !state || !savedState || state !== savedState) return fail("github_state");

  const creds = githubOAuthCreds(project.agent.gatewayEnvPrefix);
  if (!creds) return fail("github_unconfigured");

  // redirect_uri must match what /start sent — the canonical host.
  const authOrigin = process.env.GITHUB_OAUTH_ORIGIN?.trim().replace(/\/$/, "") || callbackOrigin;
  const token = await exchangeGithubCode(creds.clientId, creds.clientSecret, code, `${authOrigin}/api/auth/github/callback`);
  if (!token) return fail("github_token");

  const gh = await fetchGithubUser(token);
  if (!gh) return fail("github_user");

  // SECURITY: only members with this GitHub LINKED IN THEIR PROFILE may sign in
  // (a verified GitHub-contact or a verified-email match). No blind
  // handle-as-username fallback — otherwise a random GitHub whose handle equals a
  // member's Hive username could impersonate them.
  const username = await resolveMemberFromGithub(gh.login, gh.emails);
  console.log(`[gh-oauth] callback gh=${gh.login} → member=${username ?? "(none)"} project=${project.slug}`);
  if (!username) return fail("github_nomember");

  const access = await getAccess(username, project);
  if (!access.allowed) return fail("github_noaccess");
  console.log(`[gh-oauth] login OK ${username} on ${project.slug}`);

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
  const domain = cookieDomainFor(returnHost || req.headers.get("host"));
  const res = NextResponse.redirect(new URL(next, returnOrigin));
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    ...(domain ? { domain } : {}),
  });
  res.cookies.set("gh_oauth_state", "", { path: "/", maxAge: 0, ...(domain ? { domain } : {}) });
  return res;
}
