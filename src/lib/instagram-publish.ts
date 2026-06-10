import "server-only";

import type { ProjectConfig } from "@/projects/types";

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
  const prefix = project.agent.gatewayEnvPrefix;
  const token =
    process.env[`${prefix}_INSTAGRAM_ACCESS_TOKEN`] ??
    process.env.INSTAGRAM_ACCESS_TOKEN ??
    null;
  const igid =
    process.env[`${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID`] ??
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ??
    null;
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
      throw new Error("Instagram reel container processing failed — check video format and codec (H.264, AAC audio, MP4).");
    }
    // IN_PROGRESS / PUBLISHED / EXPIRED — keep polling for FINISHED
  }
  throw new Error("Instagram reel container timed out after 4 minutes — the video may be too large or in an unsupported format.");
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
        return { ok: false, error: "Carousel requires 2–10 images." };
      }
      const childIds: string[] = [];
      for (const url of mediaUrls) {
        const child = await graphPost(`/${igid}/media`, {
          image_url: url,
          is_carousel_item: true,
        }, token);
        if (!child.id) throw new Error("No child container id returned.");
        childIds.push(child.id);
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
