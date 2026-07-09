import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeHomepageDoc } from "@/lib/homepage-config";

export const dynamic = "force-dynamic";

// Public, read-only CURRENT (latest published) homepage config for a project.
// skatehive3.0's /home route fetches this cross-origin. The doc is
// self-contained (refs + copy + chosen images) — NO server-side hydration here;
// sk3 hydrates the money/status-shaped bits (rewards total, live bounty
// amounts) itself so this endpoint stays a cheap static read.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, s-maxage=120",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const slug = (new URL(req.url).searchParams.get("project") || "skatehive").toLowerCase();

  const row = await prisma.homepageConfig
    .findFirst({
      where: { projectSlug: slug, status: "published" },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    })
    .catch(() => null);

  if (!row) {
    // Nothing published yet → sk3 falls back / redirects to the classic feed.
    return NextResponse.json({ config: null }, { headers: CORS });
  }

  return NextResponse.json(
    {
      config: sanitizeHomepageDoc(row.data),
      version: row.version,
      publishedAt: row.publishedAt,
    },
    { headers: CORS },
  );
}
