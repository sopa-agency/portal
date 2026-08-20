import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Public list of ALL published magazine issues for a project (newest first) —
// the accumulating archive. Powers the cover selector on the website. Light:
// no post hydration, just cover/title/number/count. CORS-open.
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
  const rows = await prisma.magazineIssue
    .findMany({
      where: { projectSlug: slug, status: "published" },
      orderBy: [{ publishedAt: "desc" }, { number: "desc" }],
      include: { _count: { select: { posts: true } } },
    })
    .catch(() => []);
  const activeId = rows[0]?.id ?? null;
  return NextResponse.json(
    {
      issues: rows.map((i) => ({
        number: i.number,
        title: i.title,
        coverUrl: i.coverUrl,
        publishedAt: i.publishedAt,
        postCount: i._count.posts,
        active: i.id === activeId,
      })),
    },
    { headers: CORS },
  );
}
