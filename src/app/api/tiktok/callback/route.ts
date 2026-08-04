import { NextResponse, type NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { exchangeCodeForTokens, fetchCreatorInfo, tiktokRedirectUri } from "@/lib/tiktok";
import { STATE_COOKIE, VERIFIER_COOKIE } from "../auth/route";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Back to the TikTok screen with a message the page renders as a banner. */
function back(origin: string, params: Record<string, string>) {
  const url = new URL("/tiktok", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);

  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const denied = params.get("error");
  if (denied) {
    return back(origin, { error: params.get("error_description") ?? denied });
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const verifier = cookieStore.get(VERIFIER_COOKIE)?.value;

  if (!code) return back(origin, { error: "TikTok didn't return an authorization code." });
  if (!state || !expectedState || !sameState(state, expectedState)) {
    return back(origin, { error: "State mismatch — the authorization was not completed in this browser." });
  }
  if (!verifier) return back(origin, { error: "The PKCE verifier expired — try connecting again." });

  const result = await exchangeCodeForTokens(project, {
    code,
    redirectUri: tiktokRedirectUri(origin),
    codeVerifier: verifier,
    connectedBy: session.username,
  });
  if (!result.ok) return back(origin, { error: result.error });

  // Pull the handle right away so the UI can name the account. Non-fatal: the
  // connection is already stored and the queue refetches this anyway.
  await fetchCreatorInfo(project).catch(() => {});

  return back(origin, { connected: "1" });
}
