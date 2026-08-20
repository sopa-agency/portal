import "server-only";

// Hydrates curated magazine post refs (author + permlink) into the shape the
// SkateHive flipbook needs, straight from the Hive Bridge API. The portal owns
// WHICH posts + their ORDER (DB); this fetches the live content to render.

const HIVE_API = process.env.HIVE_API_URL || "https://api.hive.blog";

export type MagazinePost = {
  author: string;
  permlink: string;
  title: string;
  body: string; // markdown
  created: string; // ISO
  url: string; // canonical frontend URL
  thumbnail: string | null;
  payout: number; // HBD, rounded to 2dp
  blurb?: string; // editorial cover-line from the curator
  featured?: boolean;
};

type HiveBridgePost = {
  author: string;
  permlink: string;
  title?: string;
  body?: string;
  created?: string;
  pending_payout_value?: string;
  total_payout_value?: string;
  curator_payout_value?: string;
  json_metadata?: { image?: string[] } | string;
  stats?: { total_votes?: number };
};

export type TeamPost = { author: string; permlink: string; title: string; thumbnail: string | null; created: string; votes: number };

/** Recent authored posts from a set of team accounts (newest first, deduped) —
 *  the candidate pool for magazine curation. Skips snaps/thin permlinks. */
export async function fetchTeamPosts(accounts: string[], perAccount = 4): Promise<TeamPost[]> {
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const posts = await callHive<HiveBridgePost[]>("bridge.get_account_posts", {
          sort: "posts", // authored posts only (not reblogs/comments)
          account,
          limit: Math.min(perAccount, 20),
          observer: "",
        });
        return (posts ?? [])
          .filter((p) => p.title && !/^(snap-|re-)/.test(p.permlink) && !/^[a-f0-9]{6,12}$/.test(p.permlink))
          .map((p) => ({
            author: p.author,
            permlink: p.permlink,
            title: p.title ?? "(sem título)",
            thumbnail: firstImage(p),
            created: p.created ? `${p.created}` : "",
            votes: p.stats?.total_votes ?? 0,
          }));
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const out: TeamPost[] = [];
  for (const p of results.flat().sort((a, b) => (a.created < b.created ? 1 : -1))) {
    const key = `${p.author}/${p.permlink}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Recent posts under a community tag / hashtag (newest first) — the homepage
 *  composer's "search by hashtag" source. Same shape as fetchTeamPosts. */
export async function fetchTaggedPosts(tag: string, limit = 20): Promise<TeamPost[]> {
  const clean = tag.replace(/^#/, "").toLowerCase().trim();
  if (!clean) return [];
  try {
    const posts = await callHive<HiveBridgePost[]>("bridge.get_ranked_posts", {
      sort: "created",
      tag: clean,
      limit: Math.min(limit, 40),
      observer: "",
    });
    return (posts ?? [])
      .filter((p) => p.title && !/^(snap-|re-)/.test(p.permlink) && !/^[a-f0-9]{6,12}$/.test(p.permlink))
      .map((p) => ({
        author: p.author,
        permlink: p.permlink,
        title: p.title ?? "(sem título)",
        thumbnail: firstImage(p),
        created: p.created ? `${p.created}` : "",
        votes: p.stats?.total_votes ?? 0,
      }));
  } catch {
    return [];
  }
}

async function callHive<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(HIVE_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    // brief cache so repeated reads of a published issue don't hammer the RPC
    next: { revalidate: 120 },
  });
  if (!res.ok) throw new Error(`Hive ${method} -> HTTP ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: { message?: string } };
  if (data.error) throw new Error(`Hive ${method}: ${data.error.message ?? "error"}`);
  if (data.result === undefined) throw new Error(`Hive ${method}: empty result`);
  return data.result;
}

function parseMeta(raw: HiveBridgePost["json_metadata"]): { image?: string[] } {
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

function firstImage(post: HiveBridgePost): string | null {
  const meta = parseMeta(post.json_metadata);
  if (meta.image && meta.image.length > 0) return meta.image[0];
  const body = post.body ?? "";
  const md = body.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  if (md) return md[1];
  const raw = body.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/i);
  return raw ? raw[0] : null;
}

function payoutOf(post: HiveBridgePost): number {
  const num = (s?: string) => parseFloat((s ?? "0").split(" ")[0]) || 0;
  const total = num(post.total_payout_value) + num(post.curator_payout_value);
  const val = total > 0 ? total : num(post.pending_payout_value);
  return Math.round(val * 100) / 100;
}

/** Frontend post URL, e.g. https://skatehive.app/post/<community?>/@author/permlink. */
function postUrl(frontend: string, author: string, permlink: string): string {
  const base = frontend.replace(/\/$/, "");
  return `${base}/post/@${author}/${permlink}`;
}

/**
 * Hydrate an ordered list of {author, permlink} refs into MagazinePosts,
 * preserving the given order. Refs that fail to fetch are dropped (best-effort).
 */
export async function hydrateMagazinePosts(
  refs: { author: string; permlink: string; blurb?: string | null; featured?: boolean }[],
  frontend = "https://skatehive.app",
): Promise<MagazinePost[]> {
  const results = await Promise.all(
    refs.map(async (ref): Promise<MagazinePost | null> => {
      try {
        const post = await callHive<HiveBridgePost | null>("bridge.get_post", {
          author: ref.author,
          permlink: ref.permlink,
          observer: "",
        });
        if (!post || !post.author) return null;
        return {
          author: post.author,
          permlink: post.permlink,
          title: post.title ?? "(untitled)",
          body: post.body ?? "",
          created: post.created ? `${post.created}Z`.replace(/Z+$/, "Z") : new Date(0).toISOString(),
          url: postUrl(frontend, post.author, post.permlink),
          thumbnail: firstImage(post),
          payout: payoutOf(post),
          blurb: ref.blurb ?? undefined,
          featured: ref.featured ?? undefined,
        } satisfies MagazinePost;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((p): p is MagazinePost => p !== null);
}
