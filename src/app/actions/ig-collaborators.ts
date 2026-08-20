"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject, projectUmbrella } from "@/projects/index";
import { prisma, withDbRetry } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { fetchInstagramCommentThreads } from "@/lib/instagram-publish";
import { listUserbaseInstagramHandles } from "@/app/actions/userbase";

// Accumulated pool of Instagram handles to suggest as post collaborators. The
// Graph API can't list followers, so we grow our own "leading IG users" list
// from three sources: the SkateHive userbase IG identities, people who comment
// on our posts, and accounts we've actually collaborated with.
//
// The pool is shared per UMBRELLA (parent company, e.g. "reelflip") — every
// brand under it sees the same leads — while each lead's `brands` records which
// portals surfaced it, so you can still tell where a lead came from.

export type IgCollaboratorSuggestion = {
  username: string;
  fromUserbase: boolean;
  commentCount: number;
  collabCount: number;
  brands: string[];
};

const clean = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  return session ? project : null;
}

function asBrands(v: Prisma.JsonValue): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Autocomplete source — top collaborator candidates for the brand's umbrella. */
export async function listIgCollaborators(
  query = "",
  limit = 12,
): Promise<IgCollaboratorSuggestion[]> {
  const project = await gate();
  if (!project) return [];
  const umbrella = projectUmbrella(project);
  const q = clean(query);
  const rows = await withDbRetry(() =>
    prisma.igCollaborator.findMany({
      where: { umbrella, ...(q ? { username: { contains: q } } : {}) },
      orderBy: [{ collabCount: "desc" }, { commentCount: "desc" }, { lastSeenAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 50),
    }),
  ).catch(() => []);
  return rows.map((r) => ({
    username: r.username,
    fromUserbase: r.fromUserbase,
    commentCount: r.commentCount,
    collabCount: r.collabCount,
    brands: asBrands(r.brands),
  }));
}

/**
 * Add handles (if new) to the umbrella pool and bump a counter — bulk queries,
 * no per-row loop. `brand` (a project slug) is appended to each lead's `brands`
 * so we keep the origin; `fromUserbase` flags the userbase source.
 */
async function upsertHandles(
  umbrella: string,
  handles: string[],
  field: "collabCount" | "commentCount" | null,
  opts: { brand?: string; fromUserbase?: boolean } = {},
): Promise<void> {
  const list = [...new Set(handles.map(clean).filter(Boolean))];
  if (list.length === 0) return;
  const brandArr = opts.brand ? [opts.brand] : [];
  await withDbRetry(() =>
    prisma.igCollaborator.createMany({
      data: list.map((username) => ({
        umbrella,
        username,
        brands: brandArr,
        fromUserbase: !!opts.fromUserbase,
      })),
      skipDuplicates: true,
    }),
  ).catch(() => {});
  // Bump counter + recency for the whole batch (new rows start at 0 → land at 1).
  await withDbRetry(() =>
    prisma.igCollaborator.updateMany({
      where: { umbrella, username: { in: list } },
      data: {
        ...(field ? { [field]: { increment: 1 } } : {}),
        ...(opts.fromUserbase ? { fromUserbase: true } : {}),
        lastSeenAt: new Date(),
      },
    }),
  ).catch(() => {});
  // Append the brand to existing rows that don't have it yet (new rows already
  // got it via createMany). jsonb containment keeps it a set.
  if (opts.brand) {
    const b = JSON.stringify([opts.brand]);
    await withDbRetry(() =>
      prisma.$executeRaw`
        UPDATE "ig_collaborator"
        SET "brands" = "brands" || ${b}::jsonb
        WHERE "umbrella" = ${umbrella}
          AND "username" IN (${Prisma.join(list)})
          AND NOT ("brands" @> ${b}::jsonb)`,
    ).catch(() => {});
  }
}

/** Bump collabCount for handles actually tagged on a published post. */
export async function recordIgCollaborators(usernames: string[]): Promise<void> {
  const project = await gate();
  if (!project) return;
  await upsertHandles(projectUmbrella(project), usernames, "collabCount", { brand: project.slug });
}

/**
 * Grow the umbrella pool from the userbase IG identities + recent post
 * commenters. Safe to call after every publish and on demand (bulk queries).
 */
export async function syncIgCollaborators(): Promise<
  { ok: true; total: number } | { ok: false; error: string }
> {
  const project = await gate();
  if (!project) return { ok: false, error: "Unauthorized." };
  const umbrella = projectUmbrella(project);
  try {
    // 1) userbase IG handles (shared SkateHive community pool)
    const ub = await listUserbaseInstagramHandles().catch(() => []);
    await upsertHandles(umbrella, ub, null, { fromUserbase: true });

    // 2) commenters (+ repliers) on this brand's recent posts
    const threads = await fetchInstagramCommentThreads(project).catch(() => null);
    if (threads && "threads" in threads) {
      const self = clean(threads.selfUsername || "");
      const commenters = new Set<string>();
      for (const t of threads.threads) {
        for (const c of t.comments) {
          if (c.username) commenters.add(clean(c.username));
          for (const r of c.replies) if (r.username) commenters.add(clean(r.username));
        }
      }
      commenters.delete(self);
      await upsertHandles(umbrella, [...commenters], "commentCount", { brand: project.slug });
    }

    const total = await withDbRetry(() =>
      prisma.igCollaborator.count({ where: { umbrella } }),
    );
    return { ok: true, total };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
