import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { TIKTOK_AUTH_URL, TIKTOK_SCOPES, tiktokClientCreds, tiktokRedirectUri } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// Kicks off the TikTok Login Kit flow. Two short-lived cookies carry the CSRF
// state and the PKCE verifier across the round-trip to TikTok; the callback
// checks both.
export const STATE_COOKIE = "tiktok_oauth_state";
export const VERIFIER_COOKIE = "tiktok_oauth_verifier";

const base64url = (b: Buffer) => b.toString("base64url");

export async function GET() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!project.tiktok) {
    return NextResponse.json({ error: "TikTok is not enabled for this portal." }, { status: 404 });
  }

  const creds = tiktokClientCreds(project);
  if (!creds) {
    return NextResponse.json(
      {
        error: `Set ${project.agent.gatewayEnvPrefix}_TIKTOK_CLIENT_KEY and _TIKTOK_CLIENT_SECRET first.`,
      },
      { status: 400 },
    );
  }

  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const redirectUri = tiktokRedirectUri(`${proto}://${host}`);

  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const url = new URL(TIKTOK_AUTH_URL);
  url.searchParams.set("client_key", creds.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(url.toString());
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: proto === "https",
    path: "/",
    maxAge: 10 * 60,
  };
  res.cookies.set(STATE_COOKIE, state, cookieOpts);
  res.cookies.set(VERIFIER_COOKIE, verifier, cookieOpts);
  return res;
}
