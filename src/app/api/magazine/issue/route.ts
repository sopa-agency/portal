import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProject } from "@/projects/index";
import { hydrateMagazinePosts } from "@/lib/magazine";

export const dynamic = "force-dynamic";

// Public read of a SPECIFIC published issue by number (hydrated) — for opening a
// chosen cover in the flipbook. Omit `number` → latest published (same as
// /current). CORS-open.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, s-maxage=120",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slug = (sp.get("project") || "skatehive").toLowerCase();
  const numberRaw = sp.get("number");
  const number = numberRaw ? parseInt(numberRaw, 10) : null;
  const project = getProject(slug);

  const issue = await prisma.magazineIssue
    .findFirst({
      where: { projectSlug: slug, status: "published", ...(number ? { number } : {}) },
      orderBy: [{ publishedAt: "desc" }, { number: "desc" }],
      include: { posts: { orderBy: { order: "asc" } } },
    })
    .catch(() => null);

  if (!issue) return NextResponse.json({ issue: null, posts: [] }, { headers: CORS });

  const posts = await hydrateMagazinePosts(
    issue.posts.map((p) => ({ author: p.author, permlink: p.permlink, blurb: p.blurb, featured: p.featured })),
    project.hive.frontend,
  );

  return NextResponse.json(
    { issue: { number: issue.number, title: issue.title, coverUrl: issue.coverUrl, publishedAt: issue.publishedAt }, posts },
    { headers: CORS },
  );
}
