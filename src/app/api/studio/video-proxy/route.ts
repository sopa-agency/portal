import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

// Same-origin streaming proxy for IPFS videos so the editor canvas never
// taints (gateway CORS headers are inconsistent). Range requests pass
// through so <video> seeking works. Host-whitelisted, session-gated.
const ALLOWED_HOSTS = new Set([
  "ipfs.skatehive.app",
  "gateway.pinata.cloud",
  "ipfs.io",
  "cloudflare-ipfs.com",
  "w3s.link",
]);

export async function GET(req: NextRequest): Promise<Response> {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = req.nextUrl.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "url required" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  const hostOk =
    ALLOWED_HOSTS.has(parsed.hostname) ||
    // any *.mypinata.cloud dedicated gateway
    parsed.hostname.endsWith(".mypinata.cloud");
  if (parsed.protocol !== "https:" || !hostOk) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  }

  const range = req.headers.get("range");
  const upstream = await fetch(parsed.toString(), {
    headers: range ? { range } : undefined,
    cache: "no-store",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
  // IPFS is content-addressed — the bytes behind a CID never change, so cache
  // hard. `private` keeps it browser-only (the route is session-gated), and
  // `immutable` stops revalidation: thumbnail generation + add-to-bin + the
  // editor preview all reuse the same cached bytes instead of re-downloading.
  headers.set("cache-control", "private, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
