import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { brandEnv } from "@/lib/brand-env";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// TikTok Content Posting API.
//
// Two things make this unlike the Meta integration:
//
//  1. Tokens live in the DB, not env. TikTok's access token lasts 24h and the
//     refresh token 365 days AND ROLLS — the refresh response may carry a NEW
//     refresh_token that must overwrite the stored one, or the chain breaks and
//     the brand has to re-authorize by hand.
//  2. Until TikTok audits the app, everything it posts is forced to private.
//     `audited` on the account row reflects that; publish() downgrades the
//     privacy level rather than letting the API reject the post.
//
// Only the client key/secret come from env, per brand:
//   ${PREFIX}_TIKTOK_CLIENT_KEY / ${PREFIX}_TIKTOK_CLIENT_SECRET
// ---------------------------------------------------------------------------

const API = "https://open.tiktokapis.com";
export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";

/** Scopes the portal needs: identify the creator + publish on their behalf. */
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;

export type TikTokPrivacy =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type TikTokResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export function tiktokClientCreds(
  project: ProjectConfig,
): { clientKey: string; clientSecret: string } | null {
  const clientKey = brandEnv(project, "TIKTOK_CLIENT_KEY");
  const clientSecret = brandEnv(project, "TIKTOK_CLIENT_SECRET");
  if (!clientKey || !clientSecret) return null;
  return { clientKey, clientSecret };
}

/** Redirect URI registered on the TikTok app. Must match byte-for-byte on both
 *  the authorize and the token-exchange call, so it's derived from one place. */
export function tiktokRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/tiktok/callback`;
}

type TokenResponse = {
  open_id: string;
  scope: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TikTokResult<TokenResponse>> {
  try {
    const res = await fetch(`${API}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      cache: "no-store",
    });
    const json = (await res.json()) as TokenResponse;
    if (json.error) return { ok: false, error: json.error_description ?? json.error };
    if (!res.ok) return { ok: false, error: `TikTok token endpoint returned ${res.status}` };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Exchange the authorization code for the first token pair, and store it. */
export async function exchangeCodeForTokens(
  project: ProjectConfig,
  params: { code: string; redirectUri: string; codeVerifier: string; connectedBy?: string },
): Promise<TikTokResult<{ openId: string }>> {
  const creds = tiktokClientCreds(project);
  if (!creds) return { ok: false, error: "TikTok client key/secret not set for this project." };

  const res = await tokenRequest({
    client_key: creds.clientKey,
    client_secret: creds.clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if (!res.ok) return res;

  const t = res.data;
  const now = Date.now();
  await prisma.tikTokAccount.upsert({
    where: { projectSlug: project.slug },
    create: {
      projectSlug: project.slug,
      openId: t.open_id,
      scope: t.scope,
      accessToken: t.access_token,
      accessExpiresAt: new Date(now + t.expires_in * 1000),
      refreshToken: t.refresh_token,
      refreshExpiresAt: new Date(now + t.refresh_expires_in * 1000),
      status: "connected",
      connectedBy: params.connectedBy ?? null,
    },
    update: {
      openId: t.open_id,
      scope: t.scope,
      accessToken: t.access_token,
      accessExpiresAt: new Date(now + t.expires_in * 1000),
      refreshToken: t.refresh_token,
      refreshExpiresAt: new Date(now + t.refresh_expires_in * 1000),
      status: "connected",
      connectedBy: params.connectedBy ?? undefined,
    },
  });

  return { ok: true, data: { openId: t.open_id } };
}

/**
 * A valid access token for the project, refreshing when it's within 5 minutes
 * of expiry. ALWAYS persists the returned refresh_token — TikTok rotates it.
 */
export async function getAccessToken(project: ProjectConfig): Promise<TikTokResult<string>> {
  const account = await prisma.tikTokAccount
    .findUnique({ where: { projectSlug: project.slug } })
    .catch(() => null);
  if (!account) return { ok: false, error: "TikTok is not connected for this portal." };
  if (account.status !== "connected") return { ok: false, error: "The TikTok connection was revoked — reconnect in Settings." };

  const skewMs = 5 * 60 * 1000;
  if (account.accessExpiresAt.getTime() - skewMs > Date.now()) {
    return { ok: true, data: account.accessToken };
  }

  if (account.refreshExpiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "The TikTok refresh token expired (365 days) — reconnect in Settings." };
  }

  const creds = tiktokClientCreds(project);
  if (!creds) return { ok: false, error: "TikTok client key/secret not set for this project." };

  const res = await tokenRequest({
    client_key: creds.clientKey,
    client_secret: creds.clientSecret,
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
  });
  if (!res.ok) return res;

  const t = res.data;
  const now = Date.now();
  await prisma.tikTokAccount.update({
    where: { projectSlug: project.slug },
    data: {
      accessToken: t.access_token,
      accessExpiresAt: new Date(now + t.expires_in * 1000),
      // The refresh token may have rolled — storing the old one would break the
      // next refresh, so always take what came back.
      refreshToken: t.refresh_token ?? account.refreshToken,
      refreshExpiresAt: t.refresh_expires_in
        ? new Date(now + t.refresh_expires_in * 1000)
        : account.refreshExpiresAt,
      scope: t.scope ?? account.scope,
    },
  });

  return { ok: true, data: t.access_token };
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

type GraphError = { code?: string; message?: string };

async function tiktokApi<T>(
  pathname: string,
  token: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<TikTokResult<T>> {
  try {
    const res = await fetch(`${API}${pathname}`, {
      method: init?.method ?? "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json()) as { data?: T; error?: GraphError };
    const code = json.error?.code;
    // TikTok always returns an `error` object; "ok" is the success sentinel.
    if (code && code !== "ok") {
      return { ok: false, error: `${code}: ${json.error?.message ?? "unknown error"}` };
    }
    if (!res.ok) return { ok: false, error: `TikTok API returned ${res.status}` };
    return { ok: true, data: (json.data ?? {}) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Creator info — required before rendering the publish screen. TikTok's UX
// guidelines say the export screen must reflect the creator's CURRENT settings
// (which privacy levels they may use, whether comments/duet/stitch are off),
// so the queue UI reads this instead of hardcoding options.
// ---------------------------------------------------------------------------

export type CreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: TikTokPrivacy[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

export async function fetchCreatorInfo(project: ProjectConfig): Promise<TikTokResult<CreatorInfo>> {
  const token = await getAccessToken(project);
  if (!token.ok) return token;

  const res = await tiktokApi<CreatorInfo>("/v2/post/publish/creator_info/query/", token.data);
  if (!res.ok) return res;

  // Cache the handle so the queue header and Settings can name the account
  // without a second round-trip.
  if (res.data.creator_username) {
    await prisma.tikTokAccount
      .update({
        where: { projectSlug: project.slug },
        data: {
          username: res.data.creator_username,
          displayName: res.data.creator_nickname ?? null,
          avatarUrl: res.data.creator_avatar_url ?? null,
        },
      })
      .catch(() => {});
  }
  return res;
}

// ---------------------------------------------------------------------------
// Direct Post
// ---------------------------------------------------------------------------

export type TikTokPublishInput = {
  caption: string;
  videoUrl: string;
  privacy: TikTokPrivacy;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  brandContent?: boolean;
  brandOrganic?: boolean;
  isAigc?: boolean;
  coverTimeMs?: number;
};

/** TikTok caps the title at 2200 UTF-16 runes. */
const CAPTION_MAX = 2200;

/**
 * Publish a video straight to the connected account.
 *
 * Video delivery uses FILE_UPLOAD (we stream the file through our server) and
 * not PULL_FROM_URL, because PULL_FROM_URL only accepts URLs on a domain
 * verified with TikTok — our media sits on the Pinata IPFS gateway, which we
 * can't verify. FILE_UPLOAD has no such requirement.
 *
 * Returns the publish_id; the post appears on the account asynchronously, so
 * callers poll {@link fetchPublishStatus}.
 */
export async function publishTikTokVideo(
  project: ProjectConfig,
  input: TikTokPublishInput,
): Promise<TikTokResult<{ publishId: string }>> {
  const token = await getAccessToken(project);
  if (!token.ok) return token;

  const account = await prisma.tikTokAccount
    .findUnique({ where: { projectSlug: project.slug } })
    .catch(() => null);

  // Unaudited clients can only post privately — asking for anything else just
  // gets rejected, so downgrade instead of failing.
  const privacy: TikTokPrivacy = account?.audited ? input.privacy : "SELF_ONLY";

  // 1. Fetch the video so we know its exact byte size (required by init).
  let video: ArrayBuffer;
  try {
    const vres = await fetch(input.videoUrl, { cache: "no-store" });
    if (!vres.ok) return { ok: false, error: `Couldn't fetch the video (${vres.status}).` };
    video = await vres.arrayBuffer();
  } catch (e) {
    return { ok: false, error: `Couldn't fetch the video: ${e instanceof Error ? e.message : String(e)}` };
  }
  const videoSize = video.byteLength;
  if (videoSize === 0) return { ok: false, error: "The video file is empty." };

  // 2. Init. Single chunk keeps this simple and is allowed as long as the whole
  //    file goes up inside the 1-hour upload window.
  const init = await tiktokApi<{ publish_id: string; upload_url: string }>(
    "/v2/post/publish/video/init/",
    token.data,
    {
      body: {
        post_info: {
          title: input.caption.slice(0, CAPTION_MAX),
          privacy_level: privacy,
          disable_comment: !!input.disableComment,
          disable_duet: !!input.disableDuet,
          disable_stitch: !!input.disableStitch,
          brand_content_toggle: !!input.brandContent,
          brand_organic_toggle: !!input.brandOrganic,
          is_aigc: !!input.isAigc,
          ...(input.coverTimeMs !== undefined
            ? { video_cover_timestamp_ms: input.coverTimeMs }
            : {}),
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      },
    },
  );
  if (!init.ok) return init;
  if (!init.data.upload_url) return { ok: false, error: "TikTok returned no upload URL." };

  // 3. Upload the bytes.
  try {
    const up = await fetch(init.data.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoSize),
        "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
      },
      body: video,
    });
    if (!up.ok) {
      return { ok: false, error: `Upload failed (${up.status} ${up.statusText}).` };
    }
  } catch (e) {
    return { ok: false, error: `Upload failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, data: { publishId: init.data.publish_id } };
}

export type PublishStatus = {
  status: string; // PROCESSING_UPLOAD | PUBLISH_COMPLETE | FAILED …
  fail_reason?: string;
  publicaly_available_post_id?: string[];
  uploaded_bytes?: number;
};

export async function fetchPublishStatus(
  project: ProjectConfig,
  publishId: string,
): Promise<TikTokResult<PublishStatus>> {
  const token = await getAccessToken(project);
  if (!token.ok) return token;
  return tiktokApi<PublishStatus>("/v2/post/publish/status/fetch/", token.data, {
    body: { publish_id: publishId },
  });
}

/** Share URL for a finished post, when TikTok gave us the post id. */
export function tiktokPostUrl(username: string | null | undefined, postId: string | undefined): string | null {
  if (!username || !postId) return null;
  return `https://www.tiktok.com/@${username.replace(/^@/, "")}/video/${postId}`;
}

/** Connection summary for the Settings page — never returns token values. */
export async function getTikTokConnection(project: ProjectConfig): Promise<{
  connected: boolean;
  username?: string | null;
  audited: boolean;
  accessExpiresAt?: Date;
  refreshExpiresAt?: Date;
  status?: string;
} | null> {
  const account = await prisma.tikTokAccount
    .findUnique({ where: { projectSlug: project.slug } })
    .catch(() => null);
  if (!account) return null;
  return {
    connected: account.status === "connected",
    username: account.username,
    audited: account.audited,
    accessExpiresAt: account.accessExpiresAt,
    refreshExpiresAt: account.refreshExpiresAt,
    status: account.status,
  };
}
