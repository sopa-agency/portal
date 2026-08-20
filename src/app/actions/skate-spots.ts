"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

// SkateHive spot map → Studio "Skate Spot Found!" template.
// The spot map is backed by the public SkateHive API: skatespots are Hive snaps
// tagged `skatespot`, whose body encodes the data we need, e.g.
//   Spot Name: waxed three stair
//   🌐 44.98898, -93.22583
//   <description>
//   ![](https://images.hive.blog/.../photo.jpg)
// We parse that into something the card template can render.

const SPOTS_API = "https://api.skatehive.app/api/v2/skatespots";
const PAGE_SIZE = 24;

export type SkateSpot = {
  id: string;
  name: string;
  /** Human/coords location string (coords by default; user can override). */
  location: string;
  coords: string | null;
  /** First photo (cover) — kept for back-compat with single-photo callers. */
  photo: string | null;
  /** Every photo in the spot post, de-duped, in body order. */
  photos: string[];
  /** The spot post's prose description (body minus name/coords/images). */
  description: string;
  author: string;
  permlink: string;
  created: string;
};

type RawSpot = {
  author?: string;
  permlink?: string;
  created?: string;
  title?: string;
  body?: string;
  tags?: string[];
};

function parseName(body: string, title?: string): string {
  return /Spot Name:\s*(.+)/i.exec(body)?.[1]?.trim() || title?.trim() || "";
}
function parseCoords(body: string): string | null {
  return (
    /🌐\s*(-?\d+\.?\d*\s*,\s*-?\d+\.?\d*)/.exec(body)?.[1]?.replace(/\s+/g, " ").trim() ||
    /^\s*(-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+)\s*$/m.exec(body)?.[1]?.trim() ||
    null
  );
}
/** Every markdown / html image in the body (de-duped, in order). */
function parsePhotos(body: string): string[] {
  const photos: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g))
    if (m[1] && !seen.has(m[1])) { seen.add(m[1]); photos.push(m[1]); }
  for (const m of body.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi))
    if (m[1] && !seen.has(m[1])) { seen.add(m[1]); photos.push(m[1]); }
  return photos;
}
function parseDescription(body: string): string {
  return body
    .replace(/^.*Spot Name:.*$/gim, "")
    .replace(/^.*🌐.*$/gm, "")
    .replace(/^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 600);
}

/**
 * LITE parse for the picker grid: only the cover photo + name + coords. The
 * heavy bits (every photo, the prose description) are parsed on demand via
 * getSkateSpot(author, permlink) when a spot is actually clicked — so opening
 * the picker stays fast and a click only pulls that one post.
 */
function parseSpotLite(post: RawSpot): SkateSpot | null {
  if (!post.author || !post.permlink) return null;
  const body = post.body ?? "";
  const coords = parseCoords(body);
  const cover = parsePhotos(body)[0] ?? null;
  return {
    id: `${post.author}/${post.permlink}`,
    name: parseName(body, post.title),
    location: coords ?? "",
    coords,
    photo: cover,
    photos: cover ? [cover] : [],
    description: "",
    author: post.author,
    permlink: post.permlink,
    created: post.created ?? "",
  };
}

function parseSpotFull(post: RawSpot): SkateSpot | null {
  if (!post.author || !post.permlink) return null;
  const body = post.body ?? "";
  const coords = parseCoords(body);
  const photos = parsePhotos(body);
  return {
    id: `${post.author}/${post.permlink}`,
    name: parseName(body, post.title),
    location: coords ?? "",
    coords,
    photo: photos[0] ?? null,
    photos,
    description: parseDescription(body),
    author: post.author,
    permlink: post.permlink,
    created: post.created ?? "",
  };
}

// In-memory list cache (per process) — opening the picker repeatedly is instant
// and we don't hammer the upstream spot API. Short TTL so new spots still show.
const CACHE_TTL_MS = 5 * 60 * 1000;
const _listCache = new Map<number, { spots: SkateSpot[]; hasMore: boolean; expires: number }>();

export async function listSkateSpots(
  page = 1,
): Promise<{ ok: true; spots: SkateSpot[]; hasMore: boolean } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };

    const cached = _listCache.get(page);
    if (cached && Date.now() < cached.expires)
      return { ok: true, spots: cached.spots, hasMore: cached.hasMore };

    const res = await fetch(`${SPOTS_API}?limit=${PAGE_SIZE}&page=${page}`, {
      headers: { Accept: "application/json", "User-Agent": "portal-skatehive" },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `Spot map API HTTP ${res.status}` };
    const data = (await res.json()) as { data?: RawSpot[] };
    const rows = Array.isArray(data?.data) ? data.data : [];
    const spots = rows
      .filter((r) => (r.tags ?? []).includes("skatespot"))
      .map(parseSpotLite)
      .filter((s): s is SkateSpot => !!s && !!s.photo); // a card needs a photo
    const hasMore = rows.length >= PAGE_SIZE;
    _listCache.set(page, { spots, hasMore, expires: Date.now() + CACHE_TTL_MS });
    return { ok: true, spots, hasMore };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const HIVE_API = "https://api.hive.blog";

/**
 * Fetch ONE spot's full data (every photo + prose description) by permlink —
 * called when a spot is clicked in the picker, so the list stays light. Goes
 * straight to the Hive node (condenser_api.get_content), no spot-API page scan.
 */
export async function getSkateSpot(
  author: string,
  permlink: string,
): Promise<{ ok: true; spot: SkateSpot } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };
    if (!author || !permlink) return { ok: false, error: "Missing author/permlink." };

    const res = await fetch(HIVE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "portal-skatehive" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "condenser_api.get_content",
        params: [author.replace(/^@/, ""), permlink],
        id: 1,
      }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `Hive API HTTP ${res.status}` };
    const json = (await res.json()) as { result?: RawSpot & { category?: string } };
    const post = json.result;
    if (!post?.author || !post?.permlink) return { ok: false, error: "Spot não encontrado." };
    const spot = parseSpotFull(post);
    if (!spot) return { ok: false, error: "Spot inválido." };
    return { ok: true, spot };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
