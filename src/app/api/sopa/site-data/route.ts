import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sopa } from "@/projects";

// ---------------------------------------------------------------------------
// PUBLIC read-only feed for the static SOPA marketing site (site-sopa, separate
// repo). Consumed at BUILD TIME. No auth, tenant-independent: queries Prisma
// directly (NOT via the sopa-boards actions, which assert the active tenant via
// the Host header — this endpoint must serve regardless of which subdomain hits
// it). The middleware whitelists this path (see src/proxy.ts PUBLIC_PATHS).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Narrow a Prisma Json value to a plain object (not array / null). */
function asObject(v: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Extract a clean [{role, username}] team list from a meta blob. */
function readTeam(meta: Record<string, unknown>): { role: string; username: string }[] {
  if (!Array.isArray(meta.team)) return [];
  return (meta.team as unknown[])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m))
    .map((m) => ({
      role: String(m.role ?? ""),
      username: String(m.username ?? m.name ?? ""),
    }))
    .filter((m) => m.username);
}

/** Extract a string[] from a meta key, dropping non-strings. */
function readStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export async function GET() {
  try {
    const usernames = sopa.allowlist;

    const [portfolioRows, capabilityRows, skillRows, castRows] = await Promise.all([
      prisma.sopaBoard.findMany({
        where: { board: "portfolio" },
        select: { id: true, title: true, body: true, meta: true, order: true, createdAt: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      prisma.sopaBoard.findMany({
        where: { board: "capacidades" },
        select: { id: true, title: true, body: true, meta: true, order: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      prisma.memberSkills.findMany({
        where: { username: { in: usernames } },
        select: { username: true, bio: true, skills: true },
      }),
      prisma.farcasterTrailCast.findMany({
        select: {
          hash: true,
          platform: true,
          authorHandle: true,
          authorSlug: true,
          text: true,
          url: true,
          postedAt: true,
        },
        orderBy: { postedAt: "desc" },
        take: 40,
      }),
    ]);

    const skillsByUser = new Map(skillRows.map((r) => [r.username, r]));
    const people = usernames.map((username) => {
      const row = skillsByUser.get(username);
      return {
        username,
        bio: row?.bio ?? null,
        skills: asObject(row?.skills),
        avatarUrl: `https://images.hive.blog/u/${username}/avatar`,
      };
    });

    const projects = portfolioRows.map((r) => {
      const meta = asObject(r.meta);
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        coverUrl: readString(meta.coverUrl) ?? readString(meta.logoUrl) ?? null,
        team: readTeam(meta),
        tags: readStringArray(meta.tags),
        type: readString(meta.type),
        year: readString(meta.year),
        order: r.order,
        createdAt: r.createdAt.toISOString(),
      };
    });

    const capabilities = capabilityRows.map((r) => {
      const meta = asObject(r.meta);
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        people: readTeam(meta).map((m) => m.username),
        order: r.order,
      };
    });

    const feed = castRows.map((c) => ({
      id: c.hash,
      platform: c.platform === "hive" ? ("hive" as const) : ("farcaster" as const),
      authorHandle: c.authorHandle ?? null,
      authorSlug: c.authorSlug,
      text: c.text,
      url: c.url ?? null,
      postedAt: c.postedAt.toISOString(),
    }));

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        people,
        projects,
        capabilities,
        feed,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "Failed to build site data" }, { status: 500 });
  }
}
