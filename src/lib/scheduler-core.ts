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
import { schedulableNetworkFor } from "@/lib/campaign-doc-kind";
import {
  publishMarketingTweetToBinance,
  publishMarketingTweetToFarcaster,
  publishMarketingTweetToHive,
} from "@/app/actions/marketing-suggestions";
import { publishInstagramPost, type IgUserTag } from "@/lib/instagram-publish";
import { publishFacebookPost, facebookCrosspostEnabled } from "@/lib/facebook-publish";
import { publishLabChannel } from "@/lib/lab-publish";
import { publishTikTokVideo, type TikTokPrivacy } from "@/lib/tiktok";
import { ensureInstagramMedia } from "@/lib/transcode-ig";
import {
  crossPostConfig,
  deliverNotice,
  listApprovedQueueIds,
  markQueueFailed,
  markQueuePublished,
  releaseClaim,
} from "@/lib/crosspost-queue";
import { pendingNotices, type NoticeKind, type NoticePayload } from "@/lib/crosspost-notices";
import { MAC_LEASE_GRACE_MS } from "@/lib/scheduler-lease";
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

// Meta caps content publishing per rolling 24h window. Hitting it means nothing
// is wrong with the post — it just has to wait its turn, which matters most when
// a curator approves a batch of cross-posts at once. The normal backoff
// (5,10,20,40,60,60 min) burns all six attempts in about two hours and kills
// perfectly good posts long before the window reopens, so rate limits get their
// own lane: retry hourly, and don't spend an attempt doing it.
const IG_RATE_LIMIT_RETRY_MS = 60 * 60_000;
const IG_RATE_LIMIT_GIVE_UP_MS = 26 * 60 * 60_000; // one full window, plus slack
function isIgRateLimit(msg: string): boolean {
  return /rate limit|request limit|limit reached|too many|maximum number of|\(#(4|17|613)\)/i.test(
    msg,
  );
}

/** DB update after a failed IG publish: retry (reschedule + backoff) or fail. */
function igFailureUpdate(
  attempts: number,
  error: string,
  now: number,
  /** When the post was queued — bounds how long a rate-limited post keeps waiting. */
  queuedAtMs?: number,
): { status: string; error: string; attempts: number; scheduledFor?: Date } {
  if (
    isIgRateLimit(error) &&
    (queuedAtMs === undefined || now - queuedAtMs < IG_RATE_LIMIT_GIVE_UP_MS)
  ) {
    // attempts deliberately unchanged: waiting out a quota isn't a failed try.
    return { status: "scheduled", error, attempts, scheduledFor: new Date(now + IG_RATE_LIMIT_RETRY_MS) };
  }
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
        // Came from the cross-post queue → tell the app, so the author sees it
        // published. The post is ALREADY live at this point, so this is strictly
        // best-effort: the .catch() keeps a write-back failure from reaching the
        // outer catch, which would reschedule an published post and post it to
        // Instagram twice. markQueuePublished also guards itself; this is the
        // second layer, so a future edit there can't reintroduce that.
        if (post.crossPostQueueId) {
          await markQueuePublished(post.crossPostQueueId, {
            igMediaId: result.igMediaId,
            permalink: result.permalink ?? null,
          }).catch(() => {});
        }
        results.push({ id: post.id, projectSlug: post.projectSlug, ok: true, igMediaId: result.igMediaId });
      } else {
        const upd = igFailureUpdate(post.attempts ?? 0, result.error, now, post.createdAt?.getTime());
        await prisma.instagramPost.update({ where: { id: post.id }, data: upd });
        // Only report back once we've actually given up — a transient failure
        // is about to be retried, and marking it `failed` would free the slot
        // for a duplicate request while our retry is still pending.
        if (post.crossPostQueueId && upd.status === "failed") {
          await markQueueFailed(post.crossPostQueueId, result.error).catch(() => {});
        }
        results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error: result.error, retrying: upd.status === "scheduled" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const upd = igFailureUpdate(post.attempts ?? 0, error, now, post.createdAt?.getTime());
      await prisma.instagramPost.update({ where: { id: post.id }, data: upd });
      if (post.crossPostQueueId && upd.status === "failed") {
        // Inside the catch already — an throw here would escape publishDueIgPosts
        // and abort the whole tick, stranding every other due post.
        await markQueueFailed(post.crossPostQueueId, error).catch(() => {});
      }
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
// TikTok scheduled-post publishing
//
// Capped low: publishTikTokVideo streams the whole file through this process
// (FILE_UPLOAD — PULL_FROM_URL would need a TikTok-verified domain, which the
// Pinata gateway isn't), so each one is heavy. Only rows a teammate approved
// (`reviewed`) are picked up — the human gate is the point of the queue.
// ---------------------------------------------------------------------------

const TIKTOK_MAX_PER_TICK = 1;

type TikTokTickResult = {
  id: string;
  projectSlug: string;
  ok: boolean;
  publishId?: string;
  error?: string;
};

async function publishDueTikTokPosts(now: number): Promise<TikTokTickResult[]> {
  const staleThreshold = new Date(now - STALE_PUBLISHING_MS);
  const candidates = await prisma.tikTokPost.findMany({
    where: {
      reviewed: true,
      OR: [
        { status: "scheduled", scheduledFor: { lte: new Date(now) } },
        { status: "publishing", updatedAt: { lte: staleThreshold } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    take: TIKTOK_MAX_PER_TICK * 3,
  });

  const results: TikTokTickResult[] = [];
  for (const post of candidates) {
    if (results.length >= TIKTOK_MAX_PER_TICK) break;

    const claim = await prisma.tikTokPost.updateMany({
      where: { id: post.id, status: { in: ["scheduled", "publishing"] } },
      data: { status: "publishing" },
    });
    if (claim.count === 0) continue; // another tick got it

    const project = getProject(post.projectSlug);

    if (!post.videoUrl) {
      await prisma.tikTokPost.update({
        where: { id: post.id },
        data: { status: "failed", error: "No video on this post." },
      });
      results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error: "No video" });
      continue;
    }

    try {
      const r = await publishTikTokVideo(project, {
        caption: post.caption,
        videoUrl: normalizeMediaUrl(post.videoUrl),
        privacy: post.privacy as TikTokPrivacy,
        disableComment: post.disableComment,
        disableDuet: post.disableDuet,
        disableStitch: post.disableStitch,
        brandContent: post.brandContent,
        brandOrganic: post.brandOrganic,
        isAigc: post.isAigc,
        coverTimeMs: post.coverTimeMs ?? undefined,
      });

      await prisma.tikTokPost.update({
        where: { id: post.id },
        data: r.ok
          ? {
              status: "published",
              publishId: r.data.publishId,
              publishedAt: new Date(now),
              scheduledFor: null,
              error: null,
              attempts: 0,
            }
          : { status: "failed", error: r.error, attempts: { increment: 1 } },
      });
      results.push({
        id: post.id,
        projectSlug: post.projectSlug,
        ok: r.ok,
        publishId: r.ok ? r.data.publishId : undefined,
        error: r.ok ? undefined : r.error,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.tikTokPost.update({
        where: { id: post.id },
        data: { status: "failed", error, attempts: { increment: 1 } },
      });
      results.push({ id: post.id, projectSlug: post.projectSlug, ok: false, error });
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
  campaignDocs?: CampaignDocResult[];
  tiktok?: TikTokTickResult[];
};

/** Publish everything currently due (tweets + Instagram + Lab cross-network).
 *  Idempotent/safe to run concurrently — each lane uses an atomic claim or
 *  clears its schedule on success. */
// ---------------------------------------------------------------------------
// Cross-post reconciliation
//
// The write-back after publishing is best-effort by design (it must never throw
// and re-publish a live post), so it CAN be lost — a dropped connection, a host
// without the userbase credentials. A curator can also delete the InstagramPost
// from Post Creator. Either way the queue row is stranded in `approved`, holding
// its slot in the app's partial unique index, and the author can never ask for
// that snap again.
//
// This is the janitor. Every write it makes is idempotent: markQueuePublished /
// markQueueFailed are guarded on `status = 'approved'`, so re-running one on an
// already-settled row updates nothing and — because the notification INSERT
// lives inside that same transaction — sends nothing twice.
// ---------------------------------------------------------------------------

const RECONCILE_EVERY_MS = 10 * 60_000;
// Old enough that a normal approve→publish has had every chance to finish, so
// we never race a healthy post that's mid-flight.
const RECONCILE_MIN_AGE_MS = 30 * 60_000;
let lastReconcileAt = 0;

async function reconcileCrossPosts(now: number): Promise<number> {
  if (now - lastReconcileAt < RECONCILE_EVERY_MS) return 0;
  lastReconcileAt = now;

  // Notices the portal claimed but never got confirmed by the app. Without this
  // retry, a network blip mid-insert means an author is simply never told —
  // which is the failure PostgREST's lack of transactions would otherwise force
  // us to accept. Delivery is idempotent: the claim was already taken, so this
  // can only ever produce the one notification that was owed.
  const owed = await pendingNotices();
  for (const n of owed) {
    await deliverNotice(n.queueId, n.kind as NoticeKind, n.payload as unknown as NoticePayload);
  }

  const ids = await listApprovedQueueIds(RECONCILE_MIN_AGE_MS);
  if (ids.length === 0) return owed.length;

  const posts = await prisma.instagramPost.findMany({
    where: { crossPostQueueId: { in: ids } },
    select: { crossPostQueueId: true, status: true, igMediaId: true, permalink: true, error: true },
  });
  const byQueueId = new Map(posts.map((p) => [p.crossPostQueueId, p]));

  let repaired = owed.length;
  for (const id of ids) {
    const post = byQueueId.get(id);

    // The post is gone — deleted after approval. Put the request back in the
    // review queue rather than leaving the author blocked on a ghost.
    if (!post) {
      await releaseClaim(id);
      repaired++;
      continue;
    }

    if (post.status === "published" && post.igMediaId) {
      await markQueuePublished(id, { igMediaId: post.igMediaId, permalink: post.permalink });
      repaired++;
    } else if (post.status === "failed") {
      await markQueueFailed(id, post.error ?? "Publicação falhou no portal.");
      repaired++;
    }
    // scheduled / publishing → legitimately still on its way. Leave it.
  }
  return repaired;
}

// ---------------------------------------------------------------------------
// Campaign calendar publishing
//
// The campaign calendar was a PLAN with no actuator: setting a date wrote
// CampaignDocument.scheduledFor, and nothing read it back to publish. The whole
// Morpheus Phase 1 calendar sat there and no post ever went out.
//
// This publishes the calendar DIRECTLY off the document, the same way the four
// lanes above publish off their own rows. Deliberately NOT by copying the text
// into LabScheduledPost: a copy goes stale the moment someone edits the doc, and
// two copies means two chances to double-post. The doc is the single source of
// truth, and `postedAt` on it is the done-marker.
//
// Assets whose kind maps to no network (Twitter, Instagram, press release, TV
// script) are skipped, not failed — a human hand-delivers those by design.
// ---------------------------------------------------------------------------

const CAMPAIGN_DOC_MAX_PER_TICK = 3;

type CampaignDocResult = {
  id: string;
  projectSlug: string;
  network: string;
  ok: boolean;
  url?: string;
  error?: string;
};

async function publishDueCampaignDocs(now: number): Promise<CampaignDocResult[]> {
  const staleThreshold = new Date(now - STALE_PUBLISHING_MS);
  const candidates = await prisma.campaignDocument.findMany({
    where: {
      scheduledFor: { lte: new Date(now) },
      postedAt: null,
      publishError: null,
      campaign: { archivedAt: null },
      OR: [{ publishingAt: null }, { publishingAt: { lte: staleThreshold } }],
    },
    orderBy: { scheduledFor: "asc" },
    take: CAMPAIGN_DOC_MAX_PER_TICK * 4,
    select: {
      id: true,
      name: true,
      content: true,
      campaign: { select: { projectSlug: true } },
    },
  });

  const results: CampaignDocResult[] = [];
  for (const doc of candidates) {
    if (results.length >= CAMPAIGN_DOC_MAX_PER_TICK) break;

    const network = schedulableNetworkFor(doc.name);
    if (!network) continue; // human-delivered asset — leave it on the calendar
    const text = doc.content.trim();
    if (!text) continue; // an empty draft is not ready; do not publish silence

    // Atomic claim. The publishingAt guard is repeated here so that two ticks
    // racing on the same doc cannot both get past it.
    const claim = await prisma.campaignDocument.updateMany({
      where: {
        id: doc.id,
        postedAt: null,
        publishError: null,
        OR: [{ publishingAt: null }, { publishingAt: { lte: staleThreshold } }],
      },
      data: { publishingAt: new Date(now) },
    });
    if (claim.count === 0) continue;

    const projectSlug = doc.campaign.projectSlug;
    const project = getProject(projectSlug);
    try {
      const r = await publishLabChannel(network, text, project);
      await prisma.campaignDocument.update({
        where: { id: doc.id },
        data: r.ok
          ? { postedAt: new Date(), postedTo: network, publishingAt: null, publishError: null }
          : { publishingAt: null, publishError: r.error },
      });
      results.push({ id: doc.id, projectSlug, network, ok: r.ok, url: r.ok ? r.url : undefined, error: r.ok ? undefined : r.error });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.campaignDocument.update({ where: { id: doc.id }, data: { publishingAt: null, publishError: error } });
      results.push({ id: doc.id, projectSlug, network, ok: false, error });
    }
  }
  return results;
}

export async function runScheduledPublish(now: number): Promise<TickResult> {
  const [tweetDue, igResults, labResults, campaignDocResults, tiktokResults] = await Promise.all([
    findDueItems(now),
    publishDueIgPosts(now),
    publishDueLabPosts(now),
    // Isolated: the TikTok lane is the newest and its table may not exist yet on
    // an environment that hasn't run create-tiktok-tables.cjs. A rejection here
    // would take the WHOLE tick down with it — including Instagram — so it
    // degrades to an empty result instead.
    // Same isolation rationale as TikTok below: a campaign-calendar failure must
    // never take Instagram and the Lab down with it.
    publishDueCampaignDocs(now).catch(() => [] as CampaignDocResult[]),
    publishDueTikTokPosts(now).catch((err) => [
      {
        id: "-",
        projectSlug: "-",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies TikTokTickResult,
    ]),
    // Never let the janitor break a tick — publishing is what matters here.
    reconcileCrossPosts(now).catch(() => 0),
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

  return {
    checkedAt: new Date(now).toISOString(),
    processed,
    instagram: igResults,
    lab: labResults,
    campaignDocs: campaignDocResults,
    tiktok: tiktokResults,
  };
}

// ---------------------------------------------------------------------------
// Mac heartbeat lease — lets the Vercel fallback know whether the Mac is alive.
// ---------------------------------------------------------------------------


/** Refresh the Mac's heartbeat. Called by the Mac worker's tick (source=mac)
 *  ONLY on a successful tick — so if the local portal/Neon is unreachable the
 *  lease goes stale and the Vercel fallback correctly takes over. */
export async function touchMacLease(now: number): Promise<void> {
  // Report whether THIS host can write cross-post results back. The curation UI
  // runs on Vercel and can't read the Mac's environment, so the publisher has to
  // say so itself — otherwise missing userbase credentials here only show
  // up after a post is already live and its author was never told.
  const crossPostReady = crossPostConfig().db ? new Date(now) : undefined;
  await prisma.schedulerLease.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastMacTickAt: new Date(now), crossPostReadyAt: crossPostReady },
    update: { lastMacTickAt: new Date(now), ...(crossPostReady ? { crossPostReadyAt: crossPostReady } : {}) },
  });
}

/** True when the Mac hasn't ticked within the grace window (or never has) —
 *  i.e. the Vercel fallback should publish. */
export async function macLeaseIsStale(now: number, graceMs = MAC_LEASE_GRACE_MS): Promise<boolean> {
  const lease = await prisma.schedulerLease.findUnique({ where: { id: "singleton" } });
  if (!lease?.lastMacTickAt) return true;
  return now - lease.lastMacTickAt.getTime() > graceMs;
}
