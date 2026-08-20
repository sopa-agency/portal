// Reads from a Hive community feed to inject real, quality posts into AI
// prompts — used by the Weekly Stoken template so the worker generates
// artifacts around actual content instead of placeholders.
//
// Community tag and frontend URL are per-project: pass opts.communityTag and
// opts.frontendUrl from the caller's ProjectConfig. When omitted, defaults to
// SkateHive values so existing callers without a config stay unchanged.

const HIVE_API = process.env.HIVE_API_URL || "https://api.hive.blog";

export type SkatehivePost = {
  author: string;
  permlink: string;
  title: string;
  url: string;
  createdAt: string; // ISO date
  excerpt: string;
  firstImage: string | null;
  netVotes: number;
  payoutHbd: number;
};

type RankedPost = {
  author: string;
  permlink: string;
  title?: string;
  body?: string;
  created?: string;
  parent_author?: string;
  payout?: number;
  stats?: { total_votes?: number };
  json_metadata?: { image?: string[] } | string;
};

async function callHiveJsonRpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(HIVE_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`Hive JSON-RPC ${method} -> HTTP ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: { message?: string } };
  if (data.error) throw new Error(`Hive JSON-RPC ${method}: ${data.error.message ?? "unknown error"}`);
  if (data.result === undefined) throw new Error(`Hive JSON-RPC ${method}: empty result`);
  return data.result;
}

function parseMetadata(raw: RankedPost["json_metadata"]): { image?: string[] } {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { image?: string[] };
    } catch {
      return {};
    }
  }
  return raw;
}

function extractFirstImage(post: RankedPost): string | null {
  const meta = parseMetadata(post.json_metadata);
  if (meta.image && meta.image.length > 0) return meta.image[0];
  const body = post.body ?? "";
  const md = body.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  if (md) return md[1];
  const raw = body.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/i);
  return raw ? raw[0] : null;
}

function extractExcerpt(body: string, max = 220): string {
  // Strip HTML tags, markdown images, code fences, and excess whitespace.
  const stripped = body
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).trim() + "…";
}

// Looks like a snap or thin comment-style post if the permlink is a short
// hash (8-12 hex chars) or starts with `snap-`. Those should not appear in
// a Weekly Stoken recap regardless of their engagement.
function isThinPermlink(permlink: string): boolean {
  if (/^snap-/.test(permlink)) return true;
  if (/^[a-f0-9]{6,12}$/.test(permlink)) return true;
  return false;
}

// Hive's bridge.get_ranked_posts caps `limit` at 20. Keep callers honest.
const MAX_RANKED_POSTS = 20;

export type FetchOptions = {
  daysBack?: number; // default 8 (covers a full week + slack)
  limit?: number; // fetched from Hive, default + max 20
  minVotes?: number; // default 5
  minBodyLength?: number; // default 250 — filters out one-liners
  /** Hive community tag to fetch. Defaults to "hive-173115" (SkateHive). */
  communityTag?: string;
  /** Hive frontend base URL for post links (e.g. "https://skatehive.app").
   *  When absent, links use https://peakd.com/@author/permlink instead. */
  frontendUrl?: string;
};

/** Build a post URL from author + permlink using the project's frontend.
 *  CANONICAL Hive post-URL builder — every read/link path should use this so
 *  the per-platform pattern stays consistent:
 *   - Project frontend set (e.g. "https://skatehive.app", the official frontend
 *     for the SkateHive/Gnars/Reelflip portals): `${frontend}/post/${author}/${permlink}`.
 *   - No frontend (e.g. KeepKey): universal PeakD `https://peakd.com/@${author}/${permlink}`.
 *  Note the PATH differs by platform — skatehive.app uses `/post/…`, peakd uses `/@…`. */
export function buildPostUrl(author: string, permlink: string, frontendUrl?: string): string {
  if (frontendUrl) {
    return `${frontendUrl.replace(/\/$/, "")}/post/${author}/${permlink}`;
  }
  return `https://peakd.com/@${author}/${permlink}`;
}

export async function fetchTopSkatehivePosts(opts: FetchOptions = {}): Promise<SkatehivePost[]> {
  const daysBack = opts.daysBack ?? 8;
  const limit = Math.min(opts.limit ?? MAX_RANKED_POSTS, MAX_RANKED_POSTS);
  const minVotes = opts.minVotes ?? 5;
  const minBody = opts.minBodyLength ?? 250;
  const communityTag = opts.communityTag ?? "hive-173115";

  const ranked = await callHiveJsonRpc<RankedPost[]>("bridge.get_ranked_posts", {
    sort: "trending",
    tag: communityTag,
    limit,
  });

  const cutoff = Date.now() - daysBack * 86_400_000;
  const posts: SkatehivePost[] = [];

  for (const post of ranked) {
    if (!post.created || !post.author || !post.permlink) continue;
    if (post.parent_author) continue; // root posts only
    const createdMs = new Date(post.created + (post.created.endsWith("Z") ? "" : "Z")).getTime();
    if (Number.isNaN(createdMs) || createdMs < cutoff) continue;
    const title = (post.title ?? "").trim();
    if (!title || title.toLowerCase() === "removed") continue;
    if (isThinPermlink(post.permlink)) continue;
    const body = post.body ?? "";
    if (body.length < minBody) continue;
    const votes = post.stats?.total_votes ?? 0;
    if (votes < minVotes) continue;

    posts.push({
      author: post.author,
      permlink: post.permlink,
      title,
      url: buildPostUrl(post.author, post.permlink, opts.frontendUrl),
      createdAt: post.created,
      excerpt: extractExcerpt(body),
      firstImage: extractFirstImage(post),
      netVotes: votes,
      payoutHbd: typeof post.payout === "number" ? post.payout : 0,
    });
  }

  // Sort by engagement (votes first, payout as tiebreak) so the top picks
  // bubble up regardless of trending shuffle.
  posts.sort((a, b) => b.netVotes - a.netVotes || b.payoutHbd - a.payoutHbd);
  return posts;
}

// Looks at a Hive account's recent root posts and returns the highest issue
// number matching `the-weekly-stoken-N` (legacy hand-posted issues) or
// `weekly-stoken-N-<campaignId8>` (portal-published via the deterministic
// mag-post permlink), so the next issue can be numbered without the user
// doing it by hand.
export async function fetchLatestWeeklyStokenIssue(account = "skatehive"): Promise<number> {
  type Discussion = { permlink?: string; parent_author?: string; created?: string };
  // Hive's condenser_api caps limit at 20 — exceeding it returns an Assert Exception.
  const result = await callHiveJsonRpc<Discussion[]>(
    "condenser_api.get_discussions_by_author_before_date",
    [account, "", new Date().toISOString().slice(0, 19), 20],
  );
  const numbers = result
    .filter((p) => !p.parent_author)
    .map((p) => p.permlink?.match(/^(?:the-)?weekly-stoken-(\d+)(?:-|$)/)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  return numbers.length ? Math.max(...numbers) : 0;
}

export function formatPostsForPrompt(posts: SkatehivePost[]): string {
  if (posts.length === 0) {
    return "(no qualifying posts found in the last week — fall back to placeholder picks and flag this in the brief).";
  }
  return posts
    .map(
      (p, i) =>
        `${i + 1}. **${p.title}** — @${p.author}\n` +
        `   URL: ${p.url}\n` +
        `   Posted: ${p.createdAt.slice(0, 10)} · ${p.netVotes} votes · ${p.payoutHbd.toFixed(2)} HBD\n` +
        `   Excerpt: ${p.excerpt}\n` +
        (p.firstImage ? `   Image: ${p.firstImage}\n` : ""),
    )
    .join("\n");
}
