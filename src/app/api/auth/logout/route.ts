import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieDomainFor } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  // Clear host-only AND the shared parent-domain cookie (a GitHub login sets it
  // on .reelflip.com) so logout always sticks.
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  const domain = cookieDomainFor(req.headers.get("host"));
  if (domain) res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, domain });
  return res;
}
