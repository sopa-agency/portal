// Shared social publishing helpers used by both Repo-to-Social and
// Marketing Suggestions. Both pipelines write to the same Hive snap
// container and Farcaster channel — the only thing that differs is
// which Prisma model stores the run.

import crypto from "node:crypto";
import type { ProjectConfig } from "@/projects/types";
import { brandEnv } from "@/lib/brand-env";
import { prisma } from "@/lib/prisma";
import { resolveFarcasterSigner } from "@/lib/farcaster-signer";

export const HIVE_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu",
];

// Legacy constants — kept for callers that don't pass a project yet.
// TODO multi-tenant: remove these once all callers pass a ProjectConfig.
export const HIVE_COMMUNITY_TAG = "hive-173115";
export const SNAPS_CONTAINER_AUTHOR = "peak.snaps";
export const FC_CHANNEL_ID = "skateboard";

export type Platform = "x" | "hive" | "farcaster" | "binance";
export type SchedulablePlatform = "hive" | "farcaster" | "binance";

export type PublishedRecord = {
  at: string;
  url?: string;
  ref?: string;
};

export type PublishResult = { ok: true; url?: string; ref?: string } | { ok: false; error: string };

function snapPermlink(): string {
  return `snap-${crypto.randomUUID()}`;
}

async function getLatestSnapsContainerPermlink(client: {
  database: { call: (m: string, p: unknown[]) => Promise<unknown> };
}): Promise<string> {
  const result = (await client.database.call("get_discussions_by_author_before_date", [
    SNAPS_CONTAINER_AUTHOR,
    "",
    new Date().toISOString().split(".")[0],
    1,
  ])) as Array<{ permlink: string }>;
  if (!result?.[0]?.permlink) throw new Error("Could not fetch peak.snaps container");
  return result[0].permlink;
}

// Posts `text` as a Hive snap (comment under peak.snaps' daily container,
// tagged with the project's community). Returns the public URL and the new
// comment's permlink so callers can persist the reference.
export async function publishSnapToHive(
  text: string,
  project?: ProjectConfig,
): Promise<PublishResult> {
  try {
    // Identity credential: never falls back across brands (see brand-env.ts).
    const account = brandEnv(project, "HIVE_POSTING_ACCOUNT");
    const key = brandEnv(project, "HIVE_POSTING_KEY");
    if (!account || !key) {
      return { ok: false, error: "HIVE_POSTING_ACCOUNT or HIVE_POSTING_KEY not set" };
    }
    if (!text?.trim()) return { ok: false, error: "Tweet text is empty" };

    // Use project community tag if available, otherwise fall back to legacy default.
    const communityTag = project?.hive.community ?? HIVE_COMMUNITY_TAG;

    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);

    const parentPermlink = await getLatestSnapsContainerPermlink(client);
    const permlink = snapPermlink();

    const imageUrls = [
      ...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g),
    ]
      .map((m) => m[1])
      .concat(text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/gi) ?? []);

    const projectName = project?.name ?? "Portal";
    const metadata = {
      app: `Marketing Portal ${projectName}`,
      tags: [communityTag, "snaps"],
      images: [...new Set(imageUrls)],
    };
    const op = [
      "comment",
      {
        parent_author: SNAPS_CONTAINER_AUTHOR,
        parent_permlink: parentPermlink,
        author: account,
        permlink,
        title: "",
        body: text,
        json_metadata: JSON.stringify(metadata),
      },
    ] as const;

    const pk = PrivateKey.fromString(key);
    await client.broadcast.sendOperations([op as never], pk);

    // TODO multi-tenant: build project-specific snap URL once other projects
    // have their own front-ends. For now skatehive.app is the canonical viewer.
    return {
      ok: true,
      url: `https://skatehive.app/post/${account}/${permlink}`,
      ref: permlink,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Casts `text` to the project's Farcaster channel via Neynar managed signer.
// Up to 2 URL embeds are inferred from the body; hive links and images win
// priority so Warpcast renders rich previews.
export async function publishCastToFarcaster(
  text: string,
  project?: ProjectConfig,
): Promise<PublishResult> {
  try {
    const prefix = project?.agent?.gatewayEnvPrefix;
    // Per-project Neynar app: the signer must be used with ITS OWN api key
    // (a signer created under one Neynar app is invalid under another's key).
    const apiKey =
      (prefix && process.env[`${prefix}_NEYNAR_API_KEY`]) ||
      process.env.NEYNAR_API_KEY;
    // Signer = identity: resolve from DB (Settings → Connect Farcaster) first,
    // then the per-project/global env var. brandEnv never crosses brands.
    const resolved = await resolveFarcasterSigner(project);
    const signerUuid = resolved?.signerUuid;
    if (!apiKey || !signerUuid) {
      return { ok: false, error: "NEYNAR_API_KEY or signer not set (connect Farcaster in Settings)" };
    }
    if (!text?.trim()) return { ok: false, error: "Tweet text is empty" };

    // Use project Farcaster channel if available, otherwise fall back to legacy.
    const channelId = project?.farcaster.channel ?? FC_CHANNEL_ID;

    const urlMatches = text.match(/https?:\/\/[^\s)]+[^\s.,;:!?)]/g) ?? [];
    const priority = (u: string): number => {
      if (u.includes("skatehive.app") || u.includes("gnars.com")) return 0;
      if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)) return 1;
      return 2;
    };
    const embedUrls = [...new Set(urlMatches)]
      .sort((a, b) => priority(a) - priority(b))
      .slice(0, 2);
    const embeds = embedUrls.map((url) => ({ url }));

    const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        signer_uuid: signerUuid,
        text,
        channel_id: channelId,
        ...(embeds.length > 0 ? { embeds } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Neynar HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const payload = (await res.json()) as {
      cast?: { hash?: string; author?: { username?: string } };
    };
    const hash = payload.cast?.hash;
    if (!hash) return { ok: false, error: "Neynar returned no cast hash" };
    const author = payload.cast?.author?.username ?? (project?.hive.account ?? "skatehive");
    return {
      ok: true,
      url: `https://warpcast.com/${author}/${hash.slice(0, 10)}`,
      ref: hash,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Strips markdown and bare URLs so Binance Square (text-only) doesn't reject
// the post. Order matters: handle image markdown before link markdown so the
// image alt text isn't left behind.
export function sanitizeForBinance(text: string): string {
  let out = text;
  // 1. Strip markdown images: ![alt](url) → (nothing)
  out = out.replace(/!\[[^\]]*\]\(https?:\/\/[^\s)]+\)/g, "");
  // 2. Strip markdown links: [label](url) → label
  out = out.replace(/\[([^\]]*)\]\(https?:\/\/[^\s)]+\)/g, "$1");
  // 3. Strip bare URLs (http/https)
  out = out.replace(/https?:\/\/[^\s)]+[^\s.,;:!?)]/g, "");
  // 4. Collapse 3+ newlines to 2
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

const BINANCE_BAPI_ERROR_MAP: Record<string, string> = {
  "220009": "Binance daily post limit reached",
  "10005": "Binance account needs identity verification",
  "20041": "Binance rejected the post (contains a URL/link)",
  "20002": "Binance rejected the post (sensitive words)",
};

// Posts `text` to Binance Square via the OpenAPI endpoint.
// The text is sanitized to plain text first (Binance rejects URLs/markdown).
// Key lookup order: project-namespaced env var, then global fallback.
export async function publishToBinanceSquare(
  text: string,
  project?: ProjectConfig,
): Promise<PublishResult> {
  try {
    // Resolve API key: project-namespaced first, then global fallback.
    // Identity credential: never falls back across brands (see brand-env.ts).
    const key = brandEnv(project, "BINANCE_SQUARE_KEY", "BINANCE_SQUARE_OPENAPI_KEY");

    if (!key) {
      return { ok: false, error: "BINANCE_SQUARE_OPENAPI_KEY not set" };
    }

    const sanitized = sanitizeForBinance(text);
    if (!sanitized) {
      return { ok: false, error: "Post text is empty after sanitization" };
    }

    const res = await fetch(
      "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add",
      {
        method: "POST",
        headers: {
          "X-Square-OpenAPI-Key": key,
          "Content-Type": "application/json",
          clienttype: "binanceSkill",
        },
        body: JSON.stringify({ bodyTextOnly: sanitized }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Binance HTTP ${res.status}: ${body.slice(0, 300)}` };
    }

    const payload = (await res.json()) as {
      code?: string;
      message?: string;
      success?: boolean;
      data?: { id?: string | number } & Record<string, unknown>;
    };

    const isSuccess = payload.success === true || payload.code === "000000";
    if (!isSuccess) {
      const code = String(payload.code ?? "");
      const friendly = BINANCE_BAPI_ERROR_MAP[code];
      const detail = payload.message ? `: ${payload.message}` : "";
      const error = friendly ?? `Binance error ${code}${detail}`;
      return { ok: false, error };
    }

    const ref = payload.data?.id != null ? String(payload.data.id) : undefined;
    return { ok: true, ...(ref ? { ref } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Dedicated SkateHive gateway — the shared `gateway.pinata.cloud` is heavily
// rate-limited (429s → broken images, worst on carousels). Override with
// PINATA_GATEWAY if needed; trailing slash is trimmed so `${GATEWAY}/${cid}` is clean.
const PINATA_GATEWAY = (process.env.PINATA_GATEWAY ?? "https://ipfs.skatehive.app/ipfs").replace(/\/+$/, "");

/**
 * Rewrite an already-stored media URL to the current gateway. IPFS is
 * content-addressed, so the same CID is served by any gateway — this repoints
 * legacy `gateway.pinata.cloud/ipfs/<cid>` URLs (saved before the switch) to
 * PINATA_GATEWAY so old drafts/scheduled posts both render AND publish.
 * Non-Pinata URLs and empty values pass through untouched.
 */
export function normalizeMediaUrl(url: string): string {
  if (!url) return url;
  return url.replace(/^https?:\/\/[^/]*\bgateway\.pinata\.cloud\/ipfs/i, PINATA_GATEWAY);
}

/** Shared media constraints for portal uploads (images vs video). */
export function mediaUploadLimit(mimeType: string):
  | { ok: true; maxBytes: number; maxLabel: string }
  | { ok: false; error: string } {
  const isImage = /^image\//.test(mimeType);
  const isVideo = /^video\//.test(mimeType);
  if (!isImage && !isVideo) {
    return { ok: false, error: `Unsupported type ${mimeType} — only image/* and video/* are accepted` };
  }
  return isVideo
    ? { ok: true, maxBytes: 100 * 1024 * 1024, maxLabel: "100MB" }
    : { ok: true, maxBytes: 8 * 1024 * 1024, maxLabel: "8MB" };
}

/**
 * Create a short-lived Pinata signed-upload URL so the BROWSER can upload media
 * directly to Pinata. This bypasses the server-action body limit (and Vercel's
 * platform request cap), which is what makes large video uploads possible.
 * The client POSTs FormData { file, network: "public" } to the returned URL and
 * reads `data.cid` from the response; the public URL is `gateway/<cid>`.
 */
export async function createPinataSignedUploadUrl(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    const limit = mediaUploadLimit(mimeType);
    if (!limit.ok) return limit;
    if (sizeBytes > limit.maxBytes) {
      return {
        ok: false,
        error: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB; max ${limit.maxLabel})`,
      };
    }

    const jwt = process.env.PINATA_JWT;
    if (!jwt) return { ok: false, error: "PINATA_JWT not set" };

    const res = await fetch("https://uploads.pinata.cloud/v3/files/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        network: "public",
        expires: 600, // seconds the signed URL stays valid — generous for big videos on slow links
        filename: `portal-${Date.now()}-${filename}`,
        max_file_size: limit.maxBytes,
        date: Math.floor(Date.now() / 1000),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata sign HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const payload = (await res.json()) as { data?: string };
    if (!payload.data) return { ok: false, error: "Pinata returned no signed URL" };
    return { ok: true, url: payload.data, gateway: PINATA_GATEWAY };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Upload any image or video file to Pinata IPFS.
 * - Images: up to 8 MB
 * - Videos: up to 100 MB
 * Returns a public `gateway.pinata.cloud/ipfs/...` URL on success.
 */
export async function uploadMediaToPinata(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const limit = mediaUploadLimit(file.type);
    if (!limit.ok) return limit;
    if (file.size > limit.maxBytes) {
      return {
        ok: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB; max ${limit.maxLabel})`,
      };
    }

    const jwt = process.env.PINATA_JWT;
    if (!jwt) return { ok: false, error: "PINATA_JWT not set" };

    const upload = new FormData();
    upload.append("file", file, file.name);
    upload.append(
      "pinataMetadata",
      JSON.stringify({ name: `portal-${Date.now()}-${file.name}` }),
    );

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: upload,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const payload = (await res.json()) as { IpfsHash?: string };
    if (!payload.IpfsHash) return { ok: false, error: "Pinata returned no IpfsHash" };
    // ?filename= keeps the original extension on the CID URL so consumers
    // (draft reload, carousel publish) can tell videos from images.
    return {
      ok: true,
      url: `${PINATA_GATEWAY}/${payload.IpfsHash}?filename=${encodeURIComponent(file.name)}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Posts `text` to a Discord channel via the HTTP API (Bot token auth).
// Splits messages longer than 2000 characters on paragraph/line boundaries
// and POSTs each chunk sequentially. Returns {ok:true} on full success, or
// {ok:false, error} on the first failure (missing config or API error).
export async function publishToDiscord(
  text: string,
  project?: ProjectConfig,
  channelIdOverride?: string,
): Promise<PublishResult> {
  try {
    const prefix = project?.agent?.gatewayEnvPrefix;
    // Identity credential: never falls back across brands (see brand-env.ts).
    const token = brandEnv(project, "DISCORD_BOT_TOKEN");
    // Channel: per-send override → saved project default (DB) → env.
    let channelId = channelIdOverride?.trim() || null;
    if (!channelId && project) {
      const saved = await prisma.discordChannelConfig.findUnique({ where: { projectSlug: project.slug } }).catch(() => null);
      channelId = saved?.channelId ?? null;
    }
    if (!channelId) channelId = brandEnv(project, "DISCORD_CHANNEL_ID") ?? null;

    if (!token || !channelId) {
      const p = prefix ?? "YOUR_PROJECT";
      return {
        ok: false,
        error: `Discord not configured — set ${p}_DISCORD_BOT_TOKEN + ${p}_DISCORD_CHANNEL_ID.`,
      };
    }

    // Split text that exceeds Discord's 2000-character limit. Prefer splitting
    // on double-newlines (paragraphs), then single newlines, then hard-cut.
    const LIMIT = 2000;
    const chunks: string[] = [];
    if (text.length <= LIMIT) {
      chunks.push(text);
    } else {
      let remaining = text;
      while (remaining.length > LIMIT) {
        // Try paragraph boundary first.
        let splitAt = remaining.lastIndexOf("\n\n", LIMIT);
        if (splitAt <= 0) {
          // Fall back to single newline.
          splitAt = remaining.lastIndexOf("\n", LIMIT);
        }
        if (splitAt <= 0) {
          // Hard cut at limit.
          splitAt = LIMIT;
        }
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
      }
      if (remaining.length > 0) chunks.push(remaining);
    }

    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const headers = {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    };

    for (const chunk of chunks) {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: chunk }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText })) as { message?: string };
        const msg = body.message ?? res.statusText;
        return { ok: false, error: `Discord API: ${msg}` };
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function uploadImageToPinata(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const MAX = 8 * 1024 * 1024;
    if (file.size > MAX) {
      return {
        ok: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB; max 8MB)`,
      };
    }
    if (!/^image\//.test(file.type)) {
      return { ok: false, error: `Unsupported type ${file.type}` };
    }

    const jwt = process.env.PINATA_JWT;
    if (!jwt) return { ok: false, error: "PINATA_JWT not set" };

    const upload = new FormData();
    upload.append("file", file, file.name);
    upload.append(
      "pinataMetadata",
      JSON.stringify({ name: `portal-${Date.now()}-${file.name}` }),
    );

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: upload,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const payload = (await res.json()) as { IpfsHash?: string };
    if (!payload.IpfsHash) return { ok: false, error: "Pinata returned no IpfsHash" };
    return { ok: true, url: `${PINATA_GATEWAY}/${payload.IpfsHash}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
