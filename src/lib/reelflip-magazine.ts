import "server-only";
import { prisma } from "@/lib/prisma";
import { uploadMediaToPinata } from "@/lib/social-publish";

// Mirrors the @reelflip Instagram into ReelflipPost for the public reelflip.com
// magazine. Media is pinned to IPFS so the page survives IG's expiring CDN URLs.

const GRAPH = "https://graph.facebook.com/v21.0";

export type ReelflipMediaItem = { kind: "image" | "video"; url: string; poster?: string | null };
export type ReelflipMagazinePost = {
  id: string;
  caption: string | null;
  mediaType: string;
  permalink: string | null;
  postedAt: string;
  coverUrl: string;
  media: ReelflipMediaItem[];
};

type IgChild = { media_type?: string; media_url?: string; thumbnail_url?: string };
type IgPost = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data?: IgChild[] };
};

function creds(): { token: string; ig: string } | null {
  const token = process.env.REELFLIP_INSTAGRAM_ACCESS_TOKEN?.trim();
  const ig = process.env.REELFLIP_INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
  return token && ig ? { token, ig } : null;
}

/** Download an IG media URL and pin it to IPFS; null on any failure. */
async function mirror(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const ext = ct.includes("video") ? "mp4" : ct.includes("png") ? "png" : "jpg";
    const file = new File([await res.arrayBuffer()], `reelflip-${ext}`, { type: ct });
    const up = await uploadMediaToPinata(file);
    return up.ok ? up.url : null;
  } catch {
    return null;
  }
}

/** Mirror EVERY media item of the post, in order — carousels are the whole
 *  point, so all their slides must be included. Each image/video is pinned to
 *  IPFS. Cover is the first durable (pinned) image; posts with no pinnable image
 *  are skipped by the caller. */
async function buildMedia(post: IgPost): Promise<{ cover: string | null; media: ReelflipMediaItem[] }> {
  const children = post.media_type === "CAROUSEL_ALBUM"
    ? post.children?.data ?? []
    : [{ media_type: post.media_type, media_url: post.media_url, thumbnail_url: post.thumbnail_url }];
  const items: ReelflipMediaItem[] = [];
  let cover: string | null = null;
  for (const c of children.slice(0, 20)) {
    if (c.media_type === "VIDEO") {
      const poster = await mirror(c.thumbnail_url);
      const vid = (await mirror(c.media_url)) ?? c.media_url ?? null; // pin, else IG url
      if (vid) items.push({ kind: "video", url: vid, poster: poster ?? c.thumbnail_url ?? null });
      if (poster && !cover) cover = poster;
    } else {
      const img = await mirror(c.media_url);
      if (img) {
        items.push({ kind: "image", url: img });
        if (!cover) cover = img;
      }
    }
  }
  return { cover, media: items };
}

/**
 * Sync the @reelflip archive. Idempotent: posts already mirrored (row exists) are
 * skipped unless `force`. Returns counts. Bounded by `max` posts per run.
 */
export async function syncReelflipInstagram(opts: { force?: boolean; max?: number } = {}): Promise<{ ok: true; synced: number; skipped: number; total: number } | { ok: false; error: string }> {
  const c = creds();
  if (!c) return { ok: false, error: "REELFLIP_INSTAGRAM_ACCESS_TOKEN / _BUSINESS_ACCOUNT_ID não configurados." };

  // Page all media (newest first, as IG returns).
  const posts: IgPost[] = [];
  let url: string | null =
    `${GRAPH}/${c.ig}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}&limit=50&access_token=${c.token}`;
  while (url) {
    const r = (await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json()) as { data?: IgPost[]; paging?: { next?: string }; error?: { message?: string } };
    if (r.error) return { ok: false, error: r.error.message ?? "Graph API error" };
    posts.push(...(r.data ?? []));
    url = r.paging?.next ?? null;
    if (opts.max && posts.length >= opts.max) break;
  }
  const capped = opts.max ? posts.slice(0, opts.max) : posts;

  const existing = new Set((await prisma.reelflipPost.findMany({ select: { igId: true } })).map((p) => p.igId));
  let synced = 0;
  let skipped = 0;
  for (let i = 0; i < capped.length; i++) {
    const post = capped[i];
    if (!opts.force && existing.has(post.id)) { skipped++; continue; }
    const { cover, media } = await buildMedia(post);
    if (!cover) { skipped++; continue; } // nothing usable to show
    await prisma.reelflipPost.upsert({
      where: { igId: post.id },
      create: {
        igId: post.id,
        caption: post.caption ?? null,
        mediaType: post.media_type ?? "IMAGE",
        permalink: post.permalink ?? null,
        postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
        coverUrl: cover,
        media: media as unknown as object[],
        order: i,
      },
      update: {
        caption: post.caption ?? null,
        coverUrl: cover,
        media: media as unknown as object[],
        order: i,
      },
    });
    synced++;
  }
  return { ok: true, synced, skipped, total: capped.length };
}

/** Posts for the public magazine, in reading order. */
export async function getReelflipMagazine(): Promise<ReelflipMagazinePost[]> {
  const rows = await prisma.reelflipPost.findMany({ orderBy: { order: "asc" } }).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    caption: r.caption,
    mediaType: r.mediaType,
    permalink: r.permalink,
    postedAt: r.postedAt.toISOString(),
    coverUrl: r.coverUrl,
    media: (Array.isArray(r.media) ? r.media : []) as ReelflipMediaItem[],
  }));
}
