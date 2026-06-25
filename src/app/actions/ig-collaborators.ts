"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma, withDbRetry } from "@/lib/prisma";
import { fetchInstagramCommentThreads } from "@/lib/instagram-publish";
import { listUserbaseInstagramHandles } from "@/app/actions/userbase";

// Accumulated pool of Instagram handles to suggest as post collaborators. The
// Graph API can't list followers, so we grow our own "leading IG users" list
// from three sources: the SkateHive userbase IG identities, people who comment
// on our posts, and accounts we've actually collaborated with. Synced after
// every publish + on demand. Ranked collabCount → commentCount → recency.

export type IgCollaboratorSuggestion = {
  username: string;
  fromUserbase: boolean;
  commentCount: number;
  collabCount: number;
};

const clean = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  return session ? project : null;
}

/** Autocomplete source — top collaborator candidates, "leading" first. */
export async function listIgCollaborators(
  query = "",
  limit = 12,
): Promise<IgCollaboratorSuggestion[]> {
  const project = await gate();
  if (!project) return [];
  const q = clean(query);
  const rows = await withDbRetry(() =>
    prisma.igCollaborator.findMany({
      where: { projectSlug: project.slug, ...(q ? { username: { contains: q } } : {}) },
      orderBy: [{ collabCount: "desc" }, { commentCount: "desc" }, { lastSeenAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 50),
    }),
  ).catch(() => []);
  return rows.map((r) => ({
    username: r.username,
    fromUserbase: r.fromUserbase,
    commentCount: r.commentCount,
    collabCount: r.collabCount,
  }));
}

/** Add (if new) the given handles to the pool and bump a counter — bulk, cheap. */
async function upsertHandles(
  projectSlug: string,
  handles: string[],
  field: "collabCount" | "commentCount" | null,
  fromUserbase = false,
): Promise<void> {
  const list = [...new Set(handles.map(clean).filter(Boolean))];
  if (list.length === 0) return;
  await withDbRetry(() =>
    prisma.igCollaborator.createMany({
      data: list.map((username) => ({ projectSlug, username, fromUserbase })),
      skipDuplicates: true,
    }),
  ).catch(() => {});
  // Bump the counter + recency for everyone in the batch (new rows started at 0,
  // so increment lands them at 1; existing rows go up by one).
  await withDbRetry(() =>
    prisma.igCollaborator.updateMany({
      where: { projectSlug, username: { in: list } },
      data: {
        ...(field ? { [field]: { increment: 1 } } : {}),
        ...(fromUserbase ? { fromUserbase: true } : {}),
        lastSeenAt: new Date(),
      },
    }),
  ).catch(() => {});
}

/** Bump collabCount for handles actually tagged on a published post. */
export async function recordIgCollaborators(usernames: string[]): Promise<void> {
  const project = await gate();
  if (!project) return;
  await upsertHandles(project.slug, usernames, "collabCount");
}

/**
 * Grow the pool from the userbase IG identities + recent post commenters. Safe
 * to call after every publish and on demand (bulk queries — no per-row loop).
 */
export async function syncIgCollaborators(): Promise<
  { ok: true; total: number } | { ok: false; error: string }
> {
  const project = await gate();
  if (!project) return { ok: false, error: "Unauthorized." };
  try {
    // 1) userbase IG handles (shared SkateHive community pool)
    const ub = await listUserbaseInstagramHandles().catch(() => []);
    await upsertHandles(project.slug, ub, null, true);

    // 2) commenters (+ repliers) on our recent posts
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
      await upsertHandles(project.slug, [...commenters], "commentCount");
    }

    const total = await withDbRetry(() =>
      prisma.igCollaborator.count({ where: { projectSlug: project.slug } }),
    );
    return { ok: true, total };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
