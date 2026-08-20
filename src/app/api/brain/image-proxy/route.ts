import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";

export const runtime = "nodejs";

// GET /api/brain/image-proxy?url=<https image url>
// Streams a remote image's bytes back same-origin so the cover studio can draw
// it onto a <canvas> without tainting it (cross-origin images block toBlob).
// Auth-gated to team members — it's a fetch-on-behalf, so keep it off the
// public surface and refuse anything that isn't a plain https image.

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) || // link-local + cloud metadata (169.254.169.254)
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export async function GET(req: Request) {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || isBlockedHost(target.hostname)) {
    return NextResponse.json({ ok: false, error: "URL not allowed" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "portal-skatehive/1.0 (+https://reelflip.com)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Fetch failed" }, { status: 502 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ ok: false, error: `Upstream HTTP ${upstream.status}` }, { status: 502 });
  }
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Not an image" }, { status: 415 });
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=300",
    },
  });
}
