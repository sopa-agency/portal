// Scheduler tick endpoint. The PM2 worker calls this on every poll so we can
// reuse one process for both job claiming and scheduled publishing. Hive and
// Farcaster server actions are invoked from inside the Next runtime where they
// already have access to env vars and the Prisma singleton.
//
// Handles scheduled posts from BOTH pipelines: repo-to-social runs (commits →
// tweets) and marketing-suggestions runs (community signals → tweets), PLUS
// Instagram posts with publishMode="auto".
//
// NOTE: auto-publish of Instagram posts requires a scheduler worker that POSTs
// to /api/scheduler/tick on a recurring interval (e.g. every 60s). The PM2
// workers (scripts/repo-to-social-worker.js, scripts/marketing-suggestions-worker.js)
// already do this. Manual-mode Instagram posts are NEVER auto-published here.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  publishTweetToFarcaster,
  publishTweetToHive,
  type TweetStateMap,
} from "@/app/actions/repo-to-social";
import type { SchedulablePlatform } from "@/lib/social-publish";
import {
  publishMarketingTweetToFarcaster,
  publishMarketingTweetToHive,
} from "@/app/actions/marketing-suggestions";
import { publishInstagramPost, type IgUserTag } from "@/lib/instagram-publish";
import { getProject } from "@/projects/index";

export const dynamic = "force-dynamic";

const SHARED_SECRET = process.env.SCHEDULER_TICK_SECRET;
const MAX_PER_TICK = 5;

function authorized(req: Request): boolean {
  if (!SHARED_SECRET) return true;
  const header = req.headers.get("x-scheduler-secret");
  return header === SHARED_SECRET;
}

type RunSource = "repo-to-social" | "marketing-suggestions";

type DueItem = {
  source: RunSource;
  runId: string;
  tweetIndex: number;
  platform: SchedulablePlatform;
};

function findDueInStates(
  source: RunSource,
  runId: string,
  states: TweetStateMap,
  now: number,
): DueItem[] {
  const due: DueItem[] = [];
  for (const [key, entry] of Object.entries(states)) {
    const scheduled = entry.scheduledFor;
    if (!scheduled) continue;
    for (const p of ["hive", "farcaster"] as const) {
      const whenISO = scheduled[p];
      if (!whenISO) continue;
      if (entry.publishedTo?.[p]) continue;
      const t = Date.parse(whenISO);
      if (Number.isNaN(t) || t > now) continue;
      due.push({ source, runId, tweetIndex: Number(key), platform: p });
    }
  }
  return due;
}

function statesFromJson(value: unknown): TweetStateMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as TweetStateMap;
}

async function findDueItems(now: number): Promise<DueItem[]> {
  const [repoRuns, marketingRuns] = await Promise.all([
    prisma.repoToSocialRun.findMany({
      where: { tweetStates: { not: undefined } },
      select: { id: true, tweetStates: true },
    }),
    prisma.marketingSuggestionRun.findMany({
      where: { tweetStates: { not: undefined } },
      select: { id: true, tweetStates: true },
    }),
  ]);

  const due: DueItem[] = [];
  for (const r of repoRuns) {
    const states = statesFromJson(r.tweetStates);
    if (states) due.push(...findDueInStates("repo-to-social", r.id, states, now));
  }
  for (const r of marketingRuns) {
    const states = statesFromJson(r.tweetStates);
    if (states) due.push(...findDueInStates("marketing-suggestions", r.id, states, now));
  }
  return due;
}

// Both tables share an identical tweetStates JSON shape, but Prisma generates
// per-model delegates with incompatible argument types — so the actual call
// is split per-source while the state-merging logic stays shared.
function nextStatesAfterClear(
  states: TweetStateMap,
  tweetIndex: number,
  platform: SchedulablePlatform,
): TweetStateMap | null {
  const key = String(tweetIndex);
  const entry = states[key];
  if (!entry?.scheduledFor?.[platform]) return null;
  const nextScheduled = { ...entry.scheduledFor };
  delete nextScheduled[platform];
  const nextEntry = { ...entry };
  if (Object.keys(nextScheduled).length === 0) {
    delete nextEntry.scheduledFor;
  } else {
    nextEntry.scheduledFor = nextScheduled;
  }
  return { ...states, [key]: nextEntry };
}

async function clearScheduled(
  source: RunSource,
  runId: string,
  tweetIndex: number,
  platform: SchedulablePlatform,
) {
  if (source === "repo-to-social") {
    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const states = statesFromJson(run.tweetStates) ?? {};
    const next = nextStatesAfterClear(states, tweetIndex, platform);
    if (!next) return;
    await prisma.repoToSocialRun.update({
      where: { id: runId },
      data: { tweetStates: next as unknown as object },
    });
  } else {
    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const states = statesFromJson(run.tweetStates) ?? {};
    const next = nextStatesAfterClear(states, tweetIndex, platform);
    if (!next) return;
    await prisma.marketingSuggestionRun.update({
      where: { id: runId },
      data: { tweetStates: next as unknown as object },
    });
  }
}

async function publishDue(item: DueItem) {
  if (item.source === "repo-to-social") {
    return item.platform === "hive"
      ? publishTweetToHive(item.runId, item.tweetIndex)
      : publishTweetToFarcaster(item.runId, item.tweetIndex);
  }
  return item.platform === "hive"
    ? publishMarketingTweetToHive(item.runId, item.tweetIndex)
    : publishMarketingTweetToFarcaster(item.runId, item.tweetIndex);
}

// ---------------------------------------------------------------------------
// Instagram scheduled-post publishing
// Cap to 2 per tick — Reels processing alone can take ~90s.
// Only publishMode="auto" rows are picked up; manual posts are excluded.
// ---------------------------------------------------------------------------

const IG_MAX_PER_TICK = 2;
const STALE_PUBLISHING_MS = 5 * 60 * 1000; // 5 minutes

type IgResult = {
  id: string;
  projectSlug: string;
  ok: boolean;
  igMediaId?: string;
  error?: string;
};

async function publishDueIgPosts(now: number): Promise<IgResult[]> {
  const staleThreshold = new Date(now - STALE_PUBLISHING_MS);

  // Find due auto posts. Also recover stale "publishing" rows (crashed prior tick).
  // manual posts are excluded via publishMode filter.
  const candidates = await prisma.instagramPost.findMany({
    where: {
      publishMode: "auto",
      OR: [
        {
          status: "scheduled",
          scheduledFor: { lte: new Date(now) },
        },
        {
          status: "publishing",
          updatedAt: { lte: staleThreshold },
        },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    take: IG_MAX_PER_TICK * 3, // fetch extras to allow for claim races
  });

  const results: IgResult[] = [];

  for (const post of candidates) {
    if (results.length >= IG_MAX_PER_TICK) break;

    // Atomic claim — prevents double-publish across overlapping ticks
    const claim = await prisma.instagramPost.updateMany({
      where: { id: post.id, status: { in: ["scheduled", "publishing"] } },
      data: { status: "publishing" },
    });
    if (claim.count === 0) continue; // already claimed by another tick

    // Load project config (static — no DB round-trip)
    const project = getProject(post.projectSlug);

    const mediaUrls = Array.isArray(post.mediaUrls) ? (post.mediaUrls as string[]) : [];
    const collaborators = Array.isArray(post.collaborators)
      ? (post.collaborators as string[])
      : [];
    const userTags = post.type === "IMAGE" && Array.isArray(post.userTags)
      ? (post.userTags as IgUserTag[])
      : undefined;

    try {
      const result = await publishInstagramPost(project, {
        type: post.type as "IMAGE" | "CAROUSEL" | "REELS",
        caption: post.caption,
        mediaUrls,
        collaborators: collaborators.length > 0 ? collaborators : undefined,
        firstComment: post.firstComment ?? undefined,
        userTags,
      });

      if (result.ok) {
        await prisma.instagramPost.update({
          where: { id: post.id },
          data: {
            status: "published",
            igMediaId: result.igMediaId,
            permalink: result.permalink ?? null,
            publishedAt: new Date(now),
            scheduledFor: null,
            error: null,
          },
        });
        results.push({ id: post.id, projectSlug: post.projectSlug, ok: true, igMediaId: result.igMediaId });
      } else {
        await prisma.instagramPost.update({
          where: { id: post.id },
          data: { status: "failed", error: result.error },
        });
        results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error: result.error });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.instagramPost.update({
        where: { id: post.id },
        data: { status: "failed", error },
      });
      results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error });
    }
  }

  return results;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();

  // Run tweet publishing and IG publishing concurrently
  const [tweetDue, igResults] = await Promise.all([
    findDueItems(now),
    publishDueIgPosts(now),
  ]);

  const due = tweetDue.slice(0, MAX_PER_TICK);

  const results: Array<{
    source: RunSource;
    runId: string;
    tweetIndex: number;
    platform: SchedulablePlatform;
    ok: boolean;
    error?: string;
  }> = [];

  for (const item of due) {
    try {
      const result = await publishDue(item);
      if (result.ok) await clearScheduled(item.source, item.runId, item.tweetIndex, item.platform);
      results.push({ ...item, ok: result.ok, error: result.error });
    } catch (err) {
      results.push({
        ...item,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    checkedAt: new Date(now).toISOString(),
    processed: results,
    instagram: igResults,
  });
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await findDueItems(Date.now());
  return NextResponse.json({ pendingDue: due.length });
}
