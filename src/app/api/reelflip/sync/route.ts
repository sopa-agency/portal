import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { syncReelflipInstagram } from "@/lib/reelflip-magazine";

// Mirrors the @reelflip Instagram into ReelflipPost (pins media to IPFS). Heavy
// (fetch + pin per post) → allow up to 5min. Gated to a global admin session OR a
// bearer secret (REELFLIP_SYNC_SECRET / CRON_SECRET) so it can run headless.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function bearerOk(req: Request): boolean {
  const secret = process.env.REELFLIP_SYNC_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  // Either a valid global-admin session on the active project, or the bearer secret.
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, await getActiveProject());
  if (!who?.global && !bearerOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const max = url.searchParams.get("max") ? Number(url.searchParams.get("max")) : undefined;
  const result = await syncReelflipInstagram({ force, max });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
