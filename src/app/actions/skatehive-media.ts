"use server";

// SkateHive IPFS video catalog for the Studio video editor's import panel.
// Two sources, both vote-ordered:
//   - snapfeed: comments under peak.snaps' recent daily containers, filtered
//     to skatehive-tagged snaps (same query path skatehive3.0's useSnaps uses)
//   - magazine: top-level posts in the SkateHive community (hive-173115)
// Only IPFS-hosted videos qualify (ipfs.skatehive.app et al) — that's what
// the editor can load + composite; 3speak embeds are players, not files.

const HIVE_API = "https://api.hive.blog";
const COMMUNITY = "hive-173115";
const SNAP_CONTAINER_ACCOUNT = "peak.snaps";
const SNAP_CONTAINERS_TO_SCAN = 10;

export type SkatehiveVideo = {
  id: string;
  author: string;
  title: string;
  votes: number;
  payout: number;
  url: string;
  source: "snap" | "magazine";
  created: string;
  permlink: string;
};

type CacheEntry = { videos: SkatehiveVideo[]; expires: number };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function hiveCall<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(HIVE_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hive API HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "Hive API error");
  return json.result as T;
}

/** IPFS video URLs from a post body (skatehive convention: iframe/video src). */
function extractIpfsVideoUrls(body: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const srcRe = /<(?:iframe|video|source)[^>]+src=["']([^"']*\/ipfs\/[^"']+)["']/gi;
  while ((m = srcRe.exec(body))) {
    if (!/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(m[1])) out.add(m[1]);
  }
  // raw ipfs mp4/webm links (rarer)
  const rawRe = /https?:\/\/[^\s"'<>)]*\/ipfs\/[^\s"'<>)]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>)]*)?/gi;
  while ((m = rawRe.exec(body))) out.add(m[0]);
  return [...out];
}

type HivePost = {
  author: string;
  permlink: string;
  title?: string;
  body?: string;
  created?: string;
  net_votes?: number;
  active_votes?: unknown[];
  json_metadata?: string;
  pending_payout_value?: string;
  total_payout_value?: string;
  payout?: number;
};

function isSkatehiveTagged(post: HivePost): boolean {
  try {
    const meta = JSON.parse(post.json_metadata ?? "{}") as { tags?: string[]; app?: string };
    const tags = meta.tags ?? [];
    return (
      tags.includes(COMMUNITY) ||
      tags.includes("skatehive") ||
      /skatehive/i.test(meta.app ?? "")
    );
  } catch {
    return false;
  }
}

function toVideos(post: HivePost, source: "snap" | "magazine"): SkatehiveVideo[] {
  const urls = extractIpfsVideoUrls(post.body ?? "");
  if (urls.length === 0) return [];
  const votes = post.net_votes || post.active_votes?.length || 0;
  const payout =
    (post.payout ?? 0) > 0
      ? post.payout!
      : (parseFloat(post.pending_payout_value ?? "0") || 0) +
        (parseFloat(post.total_payout_value ?? "0") || 0);
  const title =
    (post.title?.trim() ||
      (post.body ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[#*!\[\]()>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)) || `@${post.author}`;
  return urls.map((url, i) => ({
    id: `${post.author}/${post.permlink}#${i}`,
    author: post.author,
    title,
    votes,
    payout: Math.round(payout * 100) / 100,
    url,
    source,
    created: post.created ?? "",
    permlink: post.permlink,
  }));
}

export async function listSkatehiveVideos(): Promise<
  { ok: true; videos: SkatehiveVideo[] } | { ok: false; error: string }
> {
  if (cache && Date.now() < cache.expires) return { ok: true, videos: cache.videos };
  try {
    // --- magazine: trending + fresh community posts ------------------------
    const [trending, created] = await Promise.all([
      hiveCall<HivePost[]>("bridge.get_ranked_posts", {
        sort: "trending",
        tag: COMMUNITY,
        limit: 20, // bridge hard-caps at 20
        observer: "",
      }),
      hiveCall<HivePost[]>("bridge.get_ranked_posts", {
        sort: "created",
        tag: COMMUNITY,
        limit: 20,
        observer: "",
      }),
    ]);
    const magSeen = new Set<string>();
    const magPosts = [...(trending ?? []), ...(created ?? [])].filter((p) => {
      const k = `${p.author}/${p.permlink}`;
      if (magSeen.has(k)) return false;
      magSeen.add(k);
      return true;
    });

    // --- snapfeed: skatehive-tagged comments under recent containers -------
    const containers = await hiveCall<HivePost[]>(
      "condenser_api.get_discussions_by_author_before_date",
      [SNAP_CONTAINER_ACCOUNT, "", new Date().toISOString().slice(0, 19), SNAP_CONTAINERS_TO_SCAN],
    );
    const replyBatches = await Promise.all(
      (containers ?? []).map((c) =>
        hiveCall<HivePost[]>("condenser_api.get_content_replies", [
          SNAP_CONTAINER_ACCOUNT,
          c.permlink,
        ]).catch(() => [] as HivePost[]),
      ),
    );
    const snapPosts = replyBatches.flat().filter(isSkatehiveTagged);

    const videos = [
      ...magPosts.flatMap((p) => toVideos(p, "magazine")),
      ...snapPosts.flatMap((p) => toVideos(p, "snap")),
    ]
      .sort((a, b) => b.votes - a.votes || b.payout - a.payout)
      .slice(0, 80);

    cache = { videos, expires: Date.now() + CACHE_TTL_MS };
    return { ok: true, videos };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
