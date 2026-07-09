import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProject } from "@/projects/index";
import { hydrateMagazinePosts } from "@/lib/magazine";

export const dynamic = "force-dynamic";

// Public, read-only feed of the CURRENT (latest published) magazine issue for a
// project. The SkateHive website's flipbook fetches this instead of the raw
// Bridge query. CORS-open so it can be read cross-origin from skatehive.app.
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
  const project = getProject(slug);

  const issue = await prisma.magazineIssue
    .findFirst({
      where: { projectSlug: slug, status: "published" },
      orderBy: [{ publishedAt: "desc" }, { number: "desc" }],
      include: { posts: { orderBy: { order: "asc" } } },
    })
    .catch(() => null);

  if (!issue) {
    // No curated issue yet → website should fall back to its Bridge query.
    return NextResponse.json({ issue: null, posts: [] }, { headers: CORS });
  }

  const posts = await hydrateMagazinePosts(
    issue.posts.map((p) => ({ author: p.author, permlink: p.permlink, blurb: p.blurb, featured: p.featured })),
    project.hive.frontend,
  );

  return NextResponse.json(
    {
      issue: {
        number: issue.number,
        title: issue.title,
        coverUrl: issue.coverUrl,
        publishedAt: issue.publishedAt,
      },
      posts,
    },
    { headers: CORS },
  );
}
