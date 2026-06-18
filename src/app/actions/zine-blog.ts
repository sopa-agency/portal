"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

// Blog-post images for the Zine Studio asset panel. Each Reelflip-family brand
// publishes long-form somewhere different:
//   - Gnars     → Paragraph (paragraph.com/@gnars) — RSS at api.paragraph.com
//   - SkateHive → Hive magazine (community hive-173115) via the bridge API
//   - others    → their Hive account's posts (fallback)
// We pull recent posts and surface the images embedded in them so a zine can be
// assembled from real published content.

const HIVE_API = "https://api.hive.blog";

export type ZineBlogImage = { url: string; title: string };

/** Brands whose blog lives on Paragraph → { handle }. Everything else uses Hive. */
const PARAGRAPH_BLOGS: Record<string, string> = {
  gnars: "@gnars",
};

function imageUrlsFromHtml(html: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const reImg = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = reImg.exec(html))) out.push(m[1]);
  const reEnc = /<enclosure[^>]+url=["']([^"']+)["']/gi;
  while ((m = reEnc.exec(html))) out.push(m[1]);
  return out;
}

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

// A real User-Agent — some upstreams (e.g. Paragraph) reject the default fetch
// UA / datacenter requests with no UA, which is what breaks the importer on Vercel.
const UA = "portal-skatehive/1.0 (+https://reelflip.com)";

async function fetchParagraph(handle: string): Promise<ZineBlogImage[]> {
  const res = await fetch(`https://api.paragraph.com/blogs/rss/${handle}`, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Paragraph RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items = xml.split(/<item[\s>]/).slice(1);
  const out: ZineBlogImage[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(item)?.[1]?.trim() ?? "";
    for (const url of imageUrlsFromHtml(item)) {
      if (!looksLikeImage(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title });
    }
  }
  return out;
}

type HivePost = { author: string; permlink: string; title?: string; body?: string };

async function fetchHive(tagOrAccount: { tag?: string; account?: string }): Promise<ZineBlogImage[]> {
  const call = async (method: string, params: unknown) => {
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
  const posts = tagOrAccount.tag
    ? await call("bridge.get_ranked_posts", { sort: "created", tag: tagOrAccount.tag, limit: 20, observer: "" })
    : await call("bridge.get_account_posts", { sort: "posts", account: tagOrAccount.account, limit: 20, observer: "" });
  const out: ZineBlogImage[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const title = p.title?.trim() || p.permlink;
    for (const url of imageUrlsFromMarkdown(p.body ?? "")) {
      if (!looksLikeImage(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title });
    }
  }
  return out;
}

/** Hive authors selectable in the Zine blog image filter. */
export const ZINE_BLOG_AUTHORS = ["xvlad", "nogenta", "web-gnar", "gnars", "coletivoxv", "reelflip"] as const;

export async function listZineBlogImages(
  author?: string,
): Promise<{ ok: true; images: ZineBlogImage[]; source: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    if (!project.zineStudio) return { ok: false, error: "Zine Studio not enabled." };
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };

    // Explicit author filter → that account's Hive posts (Gnars also posts to
    // Paragraph, but the author filter is about Hive blog authors).
    if (author) {
      const clean = author.toLowerCase().replace(/[^a-z0-9.-]/g, "");
      const images = await fetchHive({ account: clean });
      return { ok: true, images: images.slice(0, 60), source: `@${clean}` };
    }

    const paragraphHandle = PARAGRAPH_BLOGS[project.slug];
    if (paragraphHandle) {
      const images = await fetchParagraph(paragraphHandle);
      return { ok: true, images: images.slice(0, 60), source: `paragraph ${paragraphHandle}` };
    }
    // SkateHive → community magazine; others → their Hive account posts.
    const community = project.hive?.community;
    const account = project.hive?.account;
    const images = await fetchHive(
      project.slug === "skatehive" && community ? { tag: community } : { account },
    );
    return { ok: true, images: images.slice(0, 60), source: community ?? account ?? "hive" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zine-blog] importer failed:", msg); // surfaces in Vercel logs
    return { ok: false, error: msg };
  }
}
