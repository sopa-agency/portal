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

function parseSpot(post: RawSpot): SkateSpot | null {
  if (!post.author || !post.permlink) return null;
  const body = post.body ?? "";
  const name =
    /Spot Name:\s*(.+)/i.exec(body)?.[1]?.trim() ||
    post.title?.trim() ||
    "";
  // coords after the globe emoji (or a bare "lat, lng" line as a fallback)
  const coords =
    /🌐\s*(-?\d+\.?\d*\s*,\s*-?\d+\.?\d*)/.exec(body)?.[1]?.replace(/\s+/g, " ").trim() ||
    /^\s*(-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+)\s*$/m.exec(body)?.[1]?.trim() ||
    null;
  // every markdown / html image in the body (de-duped, in order) — a spot can
  // have multiple photos, which become a carousel in the studio.
  const photos: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (m[1] && !seen.has(m[1])) { seen.add(m[1]); photos.push(m[1]); }
  }
  for (const m of body.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    if (m[1] && !seen.has(m[1])) { seen.add(m[1]); photos.push(m[1]); }
  }
  const photo = photos[0] ?? null;
  // Description = the prose: body minus the "Spot Name:" line, the coords line,
  // and any images/embeds. What's left is the human caption for the spot.
  const description = body
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
  return {
    id: `${post.author}/${post.permlink}`,
    name,
    location: coords ?? "",
    coords,
    photo,
    photos,
    description,
    author: post.author,
    permlink: post.permlink,
    created: post.created ?? "",
  };
}

export async function listSkateSpots(
  page = 1,
): Promise<{ ok: true; spots: SkateSpot[]; hasMore: boolean } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };

    const res = await fetch(`${SPOTS_API}?limit=${PAGE_SIZE}&page=${page}`, {
      headers: { Accept: "application/json", "User-Agent": "portal-skatehive" },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `Spot map API HTTP ${res.status}` };
    const data = (await res.json()) as { data?: RawSpot[] };
    const rows = Array.isArray(data?.data) ? data.data : [];
    const spots = rows
      .filter((r) => (r.tags ?? []).includes("skatespot"))
      .map(parseSpot)
      .filter((s): s is SkateSpot => !!s && !!s.photo); // a card needs a photo
    return { ok: true, spots, hasMore: rows.length >= PAGE_SIZE };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
