import "server-only";

// Pull images embedded in recent SkateHive/Hive posts — either a community feed
// (by tag) or a single account's posts. Used as a cover-art source in the
// magazine cover studio (pick a photo straight from what's been posted). Kept
// as a plain lib (not a "use server" action) so the sync helpers can live here.

const HIVE_API = "https://api.hive.blog";
const UA = "portal-skatehive/1.0 (+https://reelflip.com)";

export type HiveImage = { url: string; title: string };

function imageUrlsFromMarkdown(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const reMd = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  while ((m = reMd.exec(body))) out.push(m[1]);
  const reHtml = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = reHtml.exec(body))) out.push(m[1]);
  return out;
}

function looksLikeImage(url: string): boolean {
  return (
    /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(url) ||
    /images\.hive\.blog|ipfs|googleapis\.com\/papyrus_images|img\.paragraph/.test(url)
  );
}

function imagesFromMeta(raw: unknown): string[] {
  let meta: { image?: unknown } | null = null;
  if (typeof raw === "string") {
    try {
      meta = JSON.parse(raw) as { image?: unknown };
    } catch {
      meta = null;
    }
  } else if (raw && typeof raw === "object") {
    meta = raw as { image?: unknown };
  }
  return Array.isArray(meta?.image) ? meta.image.filter((u): u is string => typeof u === "string") : [];
}

type HivePost = { author: string; permlink: string; title?: string; body?: string; json_metadata?: unknown };

/** Recent post images from a community tag OR a single account. Deduped. */
export async function fetchHivePostImages(source: { tag?: string; account?: string }, limit = 20): Promise<HiveImage[]> {
  const call = async (method: string, params: unknown): Promise<HivePost[]> => {
    const res = await fetch(HIVE_API, {
      method: "POST",
      headers: { "content-type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`Hive API HTTP ${res.status}`);
    const json = (await res.json()) as { result?: HivePost[] };
    return json.result ?? [];
  };
  const posts = source.tag
    ? await call("bridge.get_ranked_posts", { sort: "created", tag: source.tag, limit, observer: "" })
    : await call("bridge.get_account_posts", { sort: "posts", account: source.account, limit, observer: "" });

  const out: HiveImage[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const title = p.title?.trim() || p.permlink;
    // json_metadata images first (usually the cover), then body-embedded images.
    for (const url of [...imagesFromMeta(p.json_metadata), ...imageUrlsFromMarkdown(p.body ?? "")]) {
      if (!looksLikeImage(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title });
    }
  }
  return out;
}
