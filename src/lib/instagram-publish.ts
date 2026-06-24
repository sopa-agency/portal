import "server-only";

import type { ProjectConfig } from "@/projects/types";
import { brandEnv } from "@/lib/brand-env";

// ---------------------------------------------------------------------------
// Graph API base
// ---------------------------------------------------------------------------

const GRAPH_API = "https://graph.facebook.com/v21.0";

// ---------------------------------------------------------------------------
// Credential resolution — mirrors social-metrics.ts pattern
// ---------------------------------------------------------------------------

function resolveIgCredentials(project: ProjectConfig): {
  token: string | null;
  igid: string | null;
} {
  // Identity credentials: never fall back across brands (see brand-env.ts).
  const token = brandEnv(project, "INSTAGRAM_ACCESS_TOKEN") ?? null;
  const igid = brandEnv(project, "INSTAGRAM_BUSINESS_ACCOUNT_ID") ?? null;
  return { token, igid };
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const IG_ERROR_HINTS: Array<[string | RegExp, string]> = [
  [/media.*not.*reachable|media.*invalid|couldn't.*download/i, "Instagram could not fetch the media URL — ensure it's publicly accessible (not behind auth)."],
  [/aspect.ratio/i, "Instagram rejected the aspect ratio — supported ratios are 4:5 to 1.91:1 for images and 9:16 for Reels."],
  [/format/i, "Unsupported media format — Instagram requires JPEG for images and MP4 for Reels."],
  [/rate.limit|too many/i, "Instagram rate limit reached — try again in a few minutes."],
  [/permission/i, "Missing permission — ensure the token has instagram_content_publish scope."],
  [/business.account/i, "Cannot locate the Instagram Business Account — verify INSTAGRAM_BUSINESS_ACCOUNT_ID."],
];

function friendlyIgError(raw: string): string {
  for (const [pattern, msg] of IG_ERROR_HINTS) {
    if (typeof pattern === "string" ? raw.includes(pattern) : pattern.test(raw)) {
      return msg;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Low-level Graph API helpers
// ---------------------------------------------------------------------------

async function graphPost(
  path: string,
  params: Record<string, string | boolean>,
  token: string,
): Promise<{ id?: string; [k: string]: unknown }> {
  const body = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) {
    body.set(k, String(v));
  }
  const res = await fetch(`${GRAPH_API}${path}`, {
    method: "POST",
    body,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(friendlyIgError(msg));
  }
  return data;
}

async function graphGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH_API}${path}?${qs.toString()}`);
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (data as { error?: { message?: string } }).error) {
    const msg =
      (data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(friendlyIgError(msg));
  }
  return data;
}

// ---------------------------------------------------------------------------
// fetchRecentInstagramMedia — pull the last N published posts from the brand's
// IG account via the Graph API. Used to backfill the calendar/feed with what
// actually went live (independent of our own DB), so the calendar isn't empty
// when there are no portal-originated drafts.
// ---------------------------------------------------------------------------

export type ImportedMedia = {
  igMediaId: string;
  caption: string;
  type: "IMAGE" | "CAROUSEL" | "REELS";
  mediaUrls: string[]; // ordered public URLs (images, or per-child for carousels)
  coverUrl: string | null; // poster frame for video/reels
  permalink: string | null;
  publishedAt: string; // ISO
};

type RawMedia = {
  id: string;
  caption?: string;
  media_type?: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data?: Array<{ media_url?: string; media_type?: string; thumbnail_url?: string }> };
};

function normalizeMedia(m: RawMedia): ImportedMedia | null {
  if (!m.id) return null;
  const kind = (m.media_type ?? "IMAGE").toUpperCase();
  let type: ImportedMedia["type"] = "IMAGE";
  let mediaUrls: string[] = [];
  let coverUrl: string | null = null;

  if (kind === "CAROUSEL_ALBUM") {
    type = "CAROUSEL";
    mediaUrls = (m.children?.data ?? [])
      .map((c) => c.media_url ?? c.thumbnail_url ?? "")
      .filter(Boolean);
  } else if (kind === "VIDEO") {
    type = "REELS";
    if (m.media_url) mediaUrls = [m.media_url];
    coverUrl = m.thumbnail_url ?? null;
  } else {
    type = "IMAGE";
    if (m.media_url) mediaUrls = [m.media_url];
  }

  // No usable media (e.g. a Story-only or expired asset) → skip.
  if (mediaUrls.length === 0 && !coverUrl) return null;

  return {
    igMediaId: m.id,
    caption: m.caption ?? "",
    type,
    mediaUrls,
    coverUrl,
    permalink: m.permalink ?? null,
    publishedAt: m.timestamp ?? new Date().toISOString(),
  };
}

export async function fetchRecentInstagramMedia(
  project: ProjectConfig,
  limit = 10,
): Promise<
  { ok: true; media: ImportedMedia[] } | { ok: false; error: string }
> {
  const { token, igid } = resolveIgCredentials(project);
  if (!token || !igid) {
    return { ok: false, error: "Instagram não conectado neste portal (falta token/business id)." };
  }
  try {
    const fields =
      "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_url,media_type,thumbnail_url}";
    const data = await graphGet<{ data?: RawMedia[] }>(
      `/${igid}/media`,
      { fields, limit: String(Math.min(Math.max(limit, 1), 50)) },
      token,
    );
    const media = (data.data ?? [])
      .map(normalizeMedia)
      .filter((m): m is ImportedMedia => m !== null);
    return { ok: true, media };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Comments — read + reply on the brand's OWN media (HITL curation inbox).
// Requires the token to carry `instagram_manage_comments`. The IG Graph API
// only exposes comments on the authenticated account's own media.
// ---------------------------------------------------------------------------

export type IgCommentReply = {
  id: string;
  text: string;
  username: string;
  timestamp: string;
};
export type IgComment = IgCommentReply & {
  likeCount: number;
  hidden: boolean;
  replies: IgCommentReply[];
};
export type IgPostThread = {
  media: ImportedMedia;
  comments: IgComment[];
};

type RawComment = {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
  hidden?: boolean;
  replies?: { data?: RawComment[] };
};

function normalizeComment(c: RawComment): IgComment {
  return {
    id: c.id,
    text: c.text ?? "",
    username: c.username ?? "",
    timestamp: c.timestamp ?? new Date().toISOString(),
    likeCount: c.like_count ?? 0,
    hidden: !!c.hidden,
    replies: (c.replies?.data ?? []).map((r) => ({
      id: r.id,
      text: r.text ?? "",
      username: r.username ?? "",
      timestamp: r.timestamp ?? "",
    })),
  };
}

/**
 * Recent posts with their comment threads — the curation inbox. Pulls the last
 * `mediaLimit` posts, then each post's comments (top-level + one reply level).
 */
// Economy knobs — keep Meta Graph API calls + payload small. Scan only the most
// recent posts and pull the latest N comments each; cache so tab switches and
// reloads don't re-hit Meta.
const IG_COMMENTS_MEDIA_LIMIT = 5; // recent posts to scan for comments
const IG_COMMENTS_PER_POST = 10; // latest comments fetched per post
const IG_COMMENTS_TTL_MS = 5 * 60_000;

type CommentThreadsResult = { ok: true; threads: IgPostThread[]; selfUsername: string };
const igCommentsCache = new Map<string, { data: CommentThreadsResult; expires: number }>();
// Self handle rarely changes — cache it for a day to drop one call per load.
const igSelfCache = new Map<string, { username: string; expires: number }>();

async function fetchSelfUsername(igid: string, token: string): Promise<string> {
  const hit = igSelfCache.get(igid);
  if (hit && Date.now() < hit.expires) return hit.username;
  const me = await graphGet<{ username?: string }>(`/${igid}`, { fields: "username" }, token).catch(() => ({ username: "" }));
  const username = me.username ?? "";
  if (username) igSelfCache.set(igid, { username, expires: Date.now() + 24 * 3600_000 });
  return username;
}

export async function fetchInstagramCommentThreads(
  project: ProjectConfig,
  mediaLimit = IG_COMMENTS_MEDIA_LIMIT,
  opts?: { force?: boolean },
): Promise<CommentThreadsResult | { ok: false; error: string }> {
  const { token, igid } = resolveIgCredentials(project);
  if (!token || !igid) return { ok: false, error: "Instagram não conectado neste portal (falta token/business id)." };

  // Cache per (project, igid, window size) so "load more posts" fetches a wider
  // window instead of returning the cached smaller one. force bypasses the TTL.
  const cacheKey = `${project.slug}:${igid}:${mediaLimit}`;
  const cached = igCommentsCache.get(cacheKey);
  if (!opts?.force && cached && Date.now() < cached.expires) return cached.data;

  const mediaRes = await fetchRecentInstagramMedia(project, mediaLimit);
  if (!mediaRes.ok) return mediaRes;
  try {
    // Our own handle — used to tell whether the last message in a thread is ours
    // (handled) or the commenter replied again (needs attention).
    const selfUsername = await fetchSelfUsername(igid, token);
    const fields = "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}";
    const threads = await Promise.all(
      mediaRes.media.map(async (media): Promise<IgPostThread> => {
        try {
          // Latest comments only — reverse_chronological keeps the newest N.
          const data = await graphGet<{ data?: RawComment[] }>(
            `/${media.igMediaId}/comments`,
            { fields, limit: String(IG_COMMENTS_PER_POST) },
            token,
          );
          return { media, comments: (data.data ?? []).map(normalizeComment) };
        } catch {
          return { media, comments: [] };
        }
      }),
    );
    const result: CommentThreadsResult = { ok: true, threads: threads.filter((t) => t.comments.length > 0), selfUsername };
    igCommentsCache.set(cacheKey, { data: result, expires: Date.now() + IG_COMMENTS_TTL_MS });
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Drop the cached comment threads for a project so the next fetch is fresh
 * (call after replying/hiding so the inbox reflects the change). */
export function invalidateInstagramComments(project: ProjectConfig): void {
  const { igid } = resolveIgCredentials(project);
  if (!igid) return;
  // Keys are `${slug}:${igid}:${mediaLimit}` — drop every window for this project.
  const prefix = `${project.slug}:${igid}:`;
  for (const key of igCommentsCache.keys()) {
    if (key.startsWith(prefix)) igCommentsCache.delete(key);
  }
}

/** Reply to a specific comment (creates a threaded reply under it). */
export async function replyToInstagramComment(
  project: ProjectConfig,
  commentId: string,
  message: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { token } = resolveIgCredentials(project);
  if (!token) return { ok: false, error: "Instagram não conectado." };
  const msg = message.trim();
  if (!msg) return { ok: false, error: "Resposta vazia." };
  try {
    const r = await graphPost(`/${commentId}/replies`, { message: msg }, token);
    return { ok: true, id: r.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Hide/unhide a comment on our media. */
export async function setInstagramCommentHidden(
  project: ProjectConfig,
  commentId: string,
  hidden: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { token } = resolveIgCredentials(project);
  if (!token) return { ok: false, error: "Instagram não conectado." };
  try {
    await graphPost(`/${commentId}`, { hide: hidden }, token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Reel container polling — poll until FINISHED or ERROR, ~3s cadence, 90s max
// ---------------------------------------------------------------------------

async function pollUntilFinished(
  containerId: string,
  token: string,
): Promise<void> {
  const MAX_POLLS = 48; // 48 × 5s = 4min — Meta needs minutes to ingest big reels
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const data = await graphGet<{ status_code?: string; id: string }>(
      `/${containerId}`,
      { fields: "status_code" },
      token,
    );
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error("Instagram video container processing failed — check video format and codec (H.264, AAC audio, MP4).");
    }
    // IN_PROGRESS / PUBLISHED / EXPIRED — keep polling for FINISHED
  }
  throw new Error("Instagram video container timed out after 4 minutes — the video may be too large or in an unsupported format.");
}

// ---------------------------------------------------------------------------
// Media-kind detection — Pinata CID URLs carry a ?filename= hint; fall back
// to a HEAD content-type check for URLs without a usable extension.
// ---------------------------------------------------------------------------

async function isVideoUrl(url: string): Promise<boolean> {
  if (/\.(mp4|mov|m4v|webm|avi)(\?|#|&|$)/i.test(url)) return true;
  if (/\.(jpe?g|png|gif|webp|heic|heif)(\?|#|&|$)/i.test(url)) return false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    return (res.headers.get("content-type") ?? "").startsWith("video/");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// media_publish with transient-error recovery
// ---------------------------------------------------------------------------

// Meta sometimes answers media_publish with a transient error (code 2,
// "An unexpected error has occurred. Please retry your request later.") even
// though the publish actually went through — especially for Reels.
const TRANSIENT_IG_ERROR = /unexpected error|retry your request|temporarily unavailable|try again later/i;

/**
 * Run media_publish, recovering from Meta's transient errors: on failure,
 * wait and check whether the container reached PUBLISHED anyway (recovering
 * the media id from the account's most recent media), and retry the publish
 * if it didn't. Throws the last error when all attempts fail.
 */
async function publishContainer(
  igid: string,
  containerId: string,
  token: string,
): Promise<string> {
  const ATTEMPTS = 3;
  let lastErr: unknown;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const published = await graphPost(`/${igid}/media_publish`, {
        creation_id: containerId,
      }, token);
      if (published.id) return published.id;
      throw new Error("No media id returned by media_publish.");
    } catch (err) {
      lastErr = err;
      const transient =
        err instanceof Error && TRANSIENT_IG_ERROR.test(err.message);
      if (!transient) throw err;
    }

    // Transient failure — give Meta a moment, then check whether the publish
    // actually landed before retrying (retrying an already-published container
    // would error and mask the success).
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const status = await graphGet<{ status_code?: string }>(
        `/${containerId}`,
        { fields: "status_code" },
        token,
      );
      if (status.status_code === "PUBLISHED") {
        // Container view doesn't expose the media id — take the newest media,
        // which is the post we created seconds ago.
        const recent = await graphGet<{ data?: Array<{ id: string }> }>(
          `/${igid}/media`,
          { fields: "id", limit: "1" },
          token,
        );
        const id = recent.data?.[0]?.id;
        if (id) return id;
      }
    } catch {
      // Status check failed — fall through to the next publish attempt.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// Post-publish: best-effort permalink fetch
// ---------------------------------------------------------------------------

async function fetchPermalink(igMediaId: string, token: string): Promise<string | undefined> {
  try {
    const data = await graphGet<{ permalink?: string; id: string }>(
      `/${igMediaId}`,
      { fields: "permalink" },
      token,
    );
    return data.permalink;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type IgUserTag = {
  username: string;
  x: number; // 0..1 (relative position on the image)
  y: number; // 0..1
};

export type IgPostInput = {
  type: "IMAGE" | "CAROUSEL" | "REELS";
  caption: string;
  mediaUrls: string[];
  collaborators?: string[];
  firstComment?: string;
  /**
   * People tags — IMAGE only. x/y are relative coordinates (0..1).
   * Do NOT include music/brandedPartner/locationNote here — those are
   * manual-only fields and are never sent to the Graph API.
   */
  userTags?: IgUserTag[];
  /** REELS cover: custom image URL (Graph API cover_url). Wins over thumbOffsetMs. */
  coverUrl?: string;
  /** REELS cover: video frame at this offset in ms (Graph API thumb_offset). */
  thumbOffsetMs?: number;
};

export type IgPublishResult =
  | { ok: true; igMediaId: string; permalink?: string; firstCommentPosted?: boolean }
  | { ok: false; error: string };

/**
 * Publish an Instagram post (single image / carousel / reel) via the Graph API v21.
 *
 * Credentials are resolved from project-namespaced env vars:
 *   ${prefix}_INSTAGRAM_ACCESS_TOKEN  (or INSTAGRAM_ACCESS_TOKEN)
 *   ${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID  (or INSTAGRAM_BUSINESS_ACCOUNT_ID)
 */
// ---------------------------------------------------------------------------
// User-tag sanitisation — IMAGE only; max 20 tags; x/y clamped to 0..1
// ---------------------------------------------------------------------------

function sanitiseUserTags(raw: IgUserTag[] | undefined): IgUserTag[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const cleaned = raw
    .map((t) => ({
      username: t.username.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, ""),
      x: Math.max(0, Math.min(1, t.x)),
      y: Math.max(0, Math.min(1, t.y)),
    }))
    .filter((t) => t.username.length > 0);
  return cleaned.length > 0 ? cleaned.slice(0, 20) : undefined;
}

// ---------------------------------------------------------------------------
// Collaborator sanitisation — max 3, strip @, lowercase, alnum/._ only
// ---------------------------------------------------------------------------

function sanitiseCollaborators(raw: string[] | undefined): string[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const cleaned = raw
    .map((u) => u.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, ""))
    .filter(Boolean);
  // dedupe
  const unique = [...new Set(cleaned)];
  return unique.length > 0 ? unique.slice(0, 3) : undefined;
}

// ---------------------------------------------------------------------------
// Post first comment — non-fatal; returns whether it succeeded
// ---------------------------------------------------------------------------

async function postFirstComment(
  igMediaId: string,
  message: string,
  token: string,
): Promise<boolean> {
  try {
    await graphPost(`/${igMediaId}/comments`, { message }, token);
    return true;
  } catch {
    return false;
  }
}

export async function publishInstagramPost(
  project: ProjectConfig,
  input: IgPostInput,
): Promise<IgPublishResult> {
  try {
    const { token, igid } = resolveIgCredentials(project);
    if (!token) {
      return { ok: false, error: "INSTAGRAM_ACCESS_TOKEN not set for this project." };
    }
    if (!igid) {
      return { ok: false, error: "INSTAGRAM_BUSINESS_ACCOUNT_ID not set for this project." };
    }

    const { type, caption, mediaUrls, firstComment } = input;
    const collaborators = sanitiseCollaborators(input.collaborators);
    const collabParam: Record<string, string | boolean> = collaborators
      ? { collaborators: JSON.stringify(collaborators) }
      : {};
    // User tags — IMAGE only; sanitised here so callers don't need to pre-clean
    const userTags = type === "IMAGE" ? sanitiseUserTags(input.userTags) : undefined;

    // ------------------------------------------------------------------
    // Single image
    // ------------------------------------------------------------------
    if (type === "IMAGE") {
      if (!mediaUrls[0]) return { ok: false, error: "No image URL provided." };
      // user_tags: [{username, x, y}] — only on single-image containers.
      // Carousel/Reels user-tagging is a future extension (different API flow).
      const userTagParam: Record<string, string> = userTags
        ? { user_tags: JSON.stringify(userTags) }
        : {};
      const container = await graphPost(`/${igid}/media`, {
        image_url: mediaUrls[0],
        caption,
        ...collabParam,
        ...userTagParam,
      }, token);
      if (!container.id) throw new Error("No container id returned for IMAGE.");

      const igMediaId = await publishContainer(igid, container.id, token);

      const permalink = await fetchPermalink(igMediaId, token);

      let firstCommentPosted: boolean | undefined;
      if (firstComment?.trim()) {
        firstCommentPosted = await postFirstComment(igMediaId, firstComment.trim(), token);
      }

      return { ok: true, igMediaId, permalink, firstCommentPosted };
    }

    // ------------------------------------------------------------------
    // Carousel (2–10 images)
    // ------------------------------------------------------------------
    if (type === "CAROUSEL") {
      if (mediaUrls.length < 2 || mediaUrls.length > 10) {
        return { ok: false, error: "Carousel requires 2–10 items (photos or videos)." };
      }
      // Mixed media: video children use media_type VIDEO and need server-side
      // processing before the parent container will accept them.
      const childIds: string[] = [];
      const videoChildIds: string[] = [];
      for (const url of mediaUrls) {
        const video = await isVideoUrl(url);
        const child = await graphPost(`/${igid}/media`, video
          ? { media_type: "VIDEO", video_url: url, is_carousel_item: true }
          : { image_url: url, is_carousel_item: true }, token);
        if (!child.id) throw new Error("No child container id returned.");
        childIds.push(child.id);
        if (video) videoChildIds.push(child.id);
      }
      for (const childId of videoChildIds) {
        await pollUntilFinished(childId, token);
      }

      // collaborators go on the PARENT container, not the children
      const parent = await graphPost(`/${igid}/media`, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
        ...collabParam,
      }, token);
      if (!parent.id) throw new Error("No parent container id returned for CAROUSEL.");

      const igMediaId = await publishContainer(igid, parent.id, token);

      const permalink = await fetchPermalink(igMediaId, token);

      let firstCommentPosted: boolean | undefined;
      if (firstComment?.trim()) {
        firstCommentPosted = await postFirstComment(igMediaId, firstComment.trim(), token);
      }

      return { ok: true, igMediaId, permalink, firstCommentPosted };
    }

    // ------------------------------------------------------------------
    // Reel
    // ------------------------------------------------------------------
    if (type === "REELS") {
      if (!mediaUrls[0]) return { ok: false, error: "No video URL provided." };
      // Cover: custom image wins; otherwise a frame offset into the video.
      // (The profile grid shows a CENTER CROP of this cover — the Graph API
      // has no parameter for adjusting the grid crop.)
      const coverParam: Record<string, string> = input.coverUrl
        ? { cover_url: input.coverUrl }
        : input.thumbOffsetMs !== undefined && input.thumbOffsetMs >= 0
          ? { thumb_offset: String(Math.round(input.thumbOffsetMs)) }
          : {};
      const container = await graphPost(`/${igid}/media`, {
        media_type: "REELS",
        video_url: mediaUrls[0],
        caption,
        ...collabParam,
        ...coverParam,
      }, token);
      if (!container.id) throw new Error("No container id returned for REELS.");

      // Poll until reel is processed by Meta's servers
      await pollUntilFinished(container.id, token);

      const igMediaId = await publishContainer(igid, container.id, token);

      const permalink = await fetchPermalink(igMediaId, token);

      let firstCommentPosted: boolean | undefined;
      if (firstComment?.trim()) {
        firstCommentPosted = await postFirstComment(igMediaId, firstComment.trim(), token);
      }

      return { ok: true, igMediaId, permalink, firstCommentPosted };
    }

    return { ok: false, error: `Unknown post type: ${type as string}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
