"use server";

import { cookies } from "next/headers";
import { getActiveProject } from "@/projects/index";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { fetchTeamPosts, fetchTaggedPosts } from "@/lib/magazine";
import { fetchSinglePostImages } from "@/lib/hive-post-images";
import { listSkateSpots } from "@/app/actions/skate-spots";

// Read-only content pickers for the homepage composer. Every source is the same
// backend sk3 itself uses, so the portal stays dumb about internals: Hive Bridge
// for posts (via lib/magazine), api.skatehive.app for spots, and sk3's own
// /api/poidh/bounties route for open bounties. Team-gated like the rest.

type Err = { ok: false; error: string };

async function gate() {
  const project = await getActiveProject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const who = await authorize(token, project);
  if (!who) return { project, who: null as null };
  return { project, who };
}

export type PickerPost = { author: string; permlink: string; title: string; thumbnail: string | null; created: string; votes: number };

/** Search existing Skatehive posts to feature — by author, hashtag, or a
 *  direct @author/permlink ref. Auto-pulls the thumbnail + author the composer
 *  needs. */
export async function searchSkatehivePosts(
  q: { kind: "author" | "tag" | "ref"; value: string },
): Promise<{ ok: true; posts: PickerPost[] } | Err> {
  const { who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const value = (q.value ?? "").trim();
  if (!value) return { ok: true, posts: [] };
  try {
    if (q.kind === "author") {
      const user = value.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
      if (user.length < 3) return { ok: false, error: "Usuário inválido." };
      const posts = await fetchTeamPosts([user], 12);
      return { ok: true, posts: posts.map(toPickerPost) };
    }
    if (q.kind === "tag") {
      const posts = await fetchTaggedPosts(value, 20);
      return { ok: true, posts: posts.map(toPickerPost) };
    }
    // ref: accept "@author/permlink", "author/permlink", or a skatehive URL
    const ref = parsePostRef(value);
    if (!ref) return { ok: false, error: "Ref inválido (use @autor/permlink ou um link)." };
    const posts = await fetchTeamPosts([ref.author], 30);
    const hit = posts.filter((p) => p.permlink === ref.permlink).map(toPickerPost);
    if (hit.length > 0) return { ok: true, posts: hit };
    // Fall back to a bare ref card (image resolved on pick via getPostImages).
    return { ok: true, posts: [{ author: ref.author, permlink: ref.permlink, title: `@${ref.author}/${ref.permlink}`, thumbnail: null, created: "", votes: 0 }] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na busca." };
  }
}

/** All images in one post, for "choose a specific image from this post". */
export async function getPostImages(author: string, permlink: string): Promise<{ ok: true; images: string[] } | Err> {
  const { who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const a = (author ?? "").replace(/^@/, "").toLowerCase();
  const p = (permlink ?? "").trim();
  if (!a || !p) return { ok: false, error: "Post inválido." };
  try {
    const images = await fetchSinglePostImages(a, p);
    return { ok: true, images };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao buscar imagens." };
  }
}

export type PickerSpot = { id: string; name: string; image: string | null; author: string | null; permlink: string | null; coords: string | null };

/** Skatespots to feature (api.skatehive.app), reusing the portal spots action. */
export async function listHomepageSpotCandidates(): Promise<{ ok: true; spots: PickerSpot[] } | Err> {
  const { who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  try {
    const res = await listSkateSpots();
    if (!res.ok) return { ok: false, error: res.error };
    const spots: PickerSpot[] = res.spots.map((s) => ({
      id: `${s.author}/${s.permlink}`,
      name: s.name,
      image: s.photos[0] ?? null,
      author: s.author,
      permlink: s.permlink,
      coords: s.coords,
    }));
    return { ok: true, spots };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao listar spots." };
  }
}

export type PickerBounty = { id: string; chainId: number; name: string; issuer: string; image: string | null; amount: string };

/** Open poidh bounties to feature — sk3's own /api/poidh/bounties route, the
 *  same source its bounties page uses. Amount is ETH wei (sk3 converts to USD). */
export async function listHomepageBountyCandidates(): Promise<{ ok: true; bounties: PickerBounty[] } | Err> {
  const { who, project } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const base = (project.hive?.frontend ?? "https://skatehive.app").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/poidh/bounties?status=open&limit=100&filterSkate=true`, {
      headers: { "User-Agent": "portal-skatehive/1.0 (+https://reelflip.com)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, error: `poidh HTTP ${res.status}` };
    const json = (await res.json()) as { bounties?: Array<Record<string, unknown>> };
    const bounties: PickerBounty[] = (json.bounties ?? []).map((b) => ({
      id: String(b.id ?? ""),
      chainId: typeof b.chainId === "number" ? b.chainId : 8453,
      name: typeof b.name === "string" ? b.name : "",
      issuer: typeof b.issuer === "string" ? b.issuer : "",
      image: typeof b.imageUrl === "string" && b.imageUrl ? b.imageUrl : null,
      amount: String(b.amount ?? "0"),
    }));
    return { ok: true, bounties };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao listar bounties." };
  }
}

function toPickerPost(p: { author: string; permlink: string; title: string; thumbnail: string | null; created: string; votes: number }): PickerPost {
  return { author: p.author, permlink: p.permlink, title: p.title, thumbnail: p.thumbnail, created: p.created, votes: p.votes };
}

function parsePostRef(input: string): { author: string; permlink: string } | null {
  const s = input.trim();
  // URL form: .../@author/permlink or .../author/permlink at the end
  const m = s.match(/@?([a-z0-9.-]{3,16})\/([a-z0-9-]+)(?:[?#].*)?$/i);
  if (m) return { author: m[1].toLowerCase(), permlink: m[2] };
  return null;
}
