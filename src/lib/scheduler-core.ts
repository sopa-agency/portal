// Core orchestration for the scheduled-post autopublisher, shared by:
//   - POST /api/scheduler/tick   — the Mac PM2 worker's primary tick (residential IP)
//   - GET  /api/scheduler/cron   — the Vercel fallback cron (only when the Mac is down)
//
// Handles scheduled posts from BOTH tweet pipelines (repo-to-social,
// marketing-suggestions) PLUS Instagram posts with publishMode="auto".
// Manual-mode Instagram posts are NEVER auto-published here.
import "server-only";
import { prisma } from "@/lib/prisma";
import {
  publishTweetToBinance,
  publishTweetToFarcaster,
  publishTweetToHive,
  type TweetStateMap,
} from "@/app/actions/repo-to-social";
import { normalizeMediaUrl, type SchedulablePlatform } from "@/lib/social-publish";
import {
  publishMarketingTweetToBinance,
  publishMarketingTweetToFarcaster,
  publishMarketingTweetToHive,
} from "@/app/actions/marketing-suggestions";
import { publishInstagramPost, type IgUserTag } from "@/lib/instagram-publish";
import { publishFacebookPost, facebookCrosspostEnabled } from "@/lib/facebook-publish";
import { publishLabChannel } from "@/lib/lab-publish";
import { ensureInstagramMedia } from "@/lib/transcode-ig";
import { getProject } from "@/projects/index";

const MAX_PER_TICK = 5;

// A scheduled post must SUCCEED if the portal let it be scheduled. So on a
// failure we don't give up — unless the error is clearly permanent (the post
// itself is wrong), we reschedule with backoff and try again, up to a cap.
const MAX_IG_ATTEMPTS = 6;
function isPermanentIgError(msg: string): boolean {
  return /requires |no (image|video) url|unsupported|invalid|aspect ratio|too (long|large)|exceeds|must be|not a valid|unauthorized|não conectado|token/i.test(
    msg,
  );
}
/** DB update after a failed IG publish: retry (reschedule + backoff) or fail. */
function igFailureUpdate(
  attempts: number,
  error: string,
  now: number,
): { status: string; error: string; attempts: number; scheduledFor?: Date } {
  const next = attempts + 1;
  if (next >= MAX_IG_ATTEMPTS || isPermanentIgError(error)) {
    return { status: "failed", error, attempts: next };
  }
  const delayMin = Math.min(5 * 2 ** attempts, 60); // 5,10,20,40,60,60…
  return { status: "scheduled", error, attempts: next, scheduledFor: new Date(now + delayMin * 60_000) };
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
    for (const p of ["hive", "farcaster", "binance"] as const) {
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

export async function findDueItems(now: number): Promise<DueItem[]> {
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
    if (item.platform === "hive") return publishTweetToHive(item.runId, item.tweetIndex);
    if (item.platform === "farcaster") return publishTweetToFarcaster(item.runId, item.tweetIndex);
    return publishTweetToBinance(item.runId, item.tweetIndex);
  }
  if (item.platform === "hive") return publishMarketingTweetToHive(item.runId, item.tweetIndex);
  if (item.platform === "farcaster") {
    return publishMarketingTweetToFarcaster(item.runId, item.tweetIndex);
  }
  return publishMarketingTweetToBinance(item.runId, item.tweetIndex);
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
  /** true when the failure was transient and the post was rescheduled to retry. */
  retrying?: boolean;
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

    // Atomic claim — prevents double-publish across overlapping ticks (and
    // across the Mac tick + Vercel fallback running at the same moment).
    const claim = await prisma.instagramPost.updateMany({
      where: { id: post.id, status: { in: ["scheduled", "publishing"] } },
      data: { status: "publishing" },
    });
    if (claim.count === 0) continue; // already claimed by another tick

    // Load project config (static — no DB round-trip)
    const project = getProject(post.projectSlug);

    const rawMediaUrls = Array.isArray(post.mediaUrls) ? (post.mediaUrls as string[]).map(normalizeMediaUrl) : [];
    // Transcode any videos to IG-safe MP4 first (ffmpeg, on the Mac worker) so a
    // webm/odd-codec export never fails the publish. No-ops where ffmpeg is absent.
    const mediaUrls = await ensureInstagramMedia(rawMediaUrls);
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
        coverUrl: post.coverUrl ? normalizeMediaUrl(post.coverUrl) : undefined,
        thumbOffsetMs: post.thumbOffsetMs ?? undefined,
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
            attempts: 0,
          },
        });
        // Cross-publish to the Facebook Page (best-effort, opt-in per project).
        if (facebookCrosspostEnabled(project)) {
          await publishFacebookPost(project, {
            type: post.type as "IMAGE" | "CAROUSEL" | "REELS",
            caption: post.caption,
            mediaUrls,
          }).catch(() => {});
        }
        results.push({ id: post.id, projectSlug: post.projectSlug, ok: true, igMediaId: result.igMediaId });
      } else {
        const upd = igFailureUpdate(post.attempts ?? 0, result.error, now);
        await prisma.instagramPost.update({ where: { id: post.id }, data: upd });
        results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error: result.error, retrying: upd.status === "scheduled" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const upd = igFailureUpdate(post.attempts ?? 0, error, now);
      await prisma.instagramPost.update({ where: { id: post.id }, data: upd });
      results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error, retrying: upd.status === "scheduled" });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Lab cross-network scheduled posts (non-Instagram) — published via the shared
// publishLabChannel dispatch. Mirrors the IG lane: atomic claim + stale-recover.
// ---------------------------------------------------------------------------

const LAB_MAX_PER_TICK = 5;

type LabResult = {
  id: string;
  projectSlug: string;
  network: string;
  ok: boolean;
  url?: string;
  error?: string;
};

async function publishDueLabPosts(now: number): Promise<LabResult[]> {
  const staleThreshold = new Date(now - STALE_PUBLISHING_MS);
  const candidates = await prisma.labScheduledPost.findMany({
    where: {
      OR: [
        { status: "scheduled", scheduledFor: { lte: new Date(now) } },
        { status: "publishing", updatedAt: { lte: staleThreshold } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    take: LAB_MAX_PER_TICK * 3,
  });

  const results: LabResult[] = [];
  for (const post of candidates) {
    if (results.length >= LAB_MAX_PER_TICK) break;
    const claim = await prisma.labScheduledPost.updateMany({
      where: { id: post.id, status: { in: ["scheduled", "publishing"] } },
      data: { status: "publishing" },
    });
    if (claim.count === 0) continue;
    const project = getProject(post.projectSlug);
    try {
      const r = await publishLabChannel(post.network, post.text, project);
      await prisma.labScheduledPost.update({
        where: { id: post.id },
        data: r.ok
          ? { status: "published", resultUrl: r.url ?? null, error: null }
          : { status: "failed", error: r.error },
      });
      results.push({ id: post.id, projectSlug: post.projectSlug, network: post.network, ok: r.ok, url: r.ok ? r.url : undefined, error: r.ok ? undefined : r.error });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.labScheduledPost.update({ where: { id: post.id }, data: { status: "failed", error } });
      results.push({ id: post.id, projectSlug: post.projectSlug, network: post.network, ok: false, error });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Public orchestration
// ---------------------------------------------------------------------------

export type TickResult = {
  checkedAt: string;
  processed: Array<{
    source: RunSource;
    runId: string;
    tweetIndex: number;
    platform: SchedulablePlatform;
    ok: boolean;
    error?: string;
  }>;
  instagram: IgResult[];
  lab?: LabResult[];
};

/** Publish everything currently due (tweets + Instagram + Lab cross-network).
 *  Idempotent/safe to run concurrently — each lane uses an atomic claim or
 *  clears its schedule on success. */
export async function runScheduledPublish(now: number): Promise<TickResult> {
  const [tweetDue, igResults, labResults] = await Promise.all([
    findDueItems(now),
    publishDueIgPosts(now),
    publishDueLabPosts(now),
  ]);

  const due = tweetDue.slice(0, MAX_PER_TICK);

  const processed: TickResult["processed"] = [];
  for (const item of due) {
    try {
      const result = await publishDue(item);
      if (result.ok) await clearScheduled(item.source, item.runId, item.tweetIndex, item.platform);
      processed.push({ ...item, ok: result.ok, error: result.error });
    } catch (err) {
      processed.push({
        ...item,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { checkedAt: new Date(now).toISOString(), processed, instagram: igResults, lab: labResults };
}

// ---------------------------------------------------------------------------
// Mac heartbeat lease — lets the Vercel fallback know whether the Mac is alive.
// ---------------------------------------------------------------------------

export const MAC_LEASE_GRACE_MS = 6 * 60 * 1000; // 6 minutes

/** Refresh the Mac's heartbeat. Called by the Mac worker's tick (source=mac)
 *  ONLY on a successful tick — so if the local portal/Neon is unreachable the
 *  lease goes stale and the Vercel fallback correctly takes over. */
export async function touchMacLease(now: number): Promise<void> {
  await prisma.schedulerLease.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastMacTickAt: new Date(now) },
    update: { lastMacTickAt: new Date(now) },
  });
}

/** True when the Mac hasn't ticked within the grace window (or never has) —
 *  i.e. the Vercel fallback should publish. */
export async function macLeaseIsStale(now: number, graceMs = MAC_LEASE_GRACE_MS): Promise<boolean> {
  const lease = await prisma.schedulerLease.findUnique({ where: { id: "singleton" } });
  if (!lease?.lastMacTickAt) return true;
  return now - lease.lastMacTickAt.getTime() > graceMs;
}
