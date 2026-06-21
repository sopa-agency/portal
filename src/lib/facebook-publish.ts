import "server-only";
import { brandEnv, brandEnvByPrefix } from "@/lib/brand-env";
import type { ProjectConfig } from "@/projects/types";

// Publish to the brand's Facebook Page via the Graph API, using the SAME Meta
// token as Instagram (Page token auto-discovered through /me/accounts). This is
// a separate publish from Instagram — IG's native "share to Facebook" does NOT
// fire for API-published posts, so to land on the Page we post here directly.
//
// Opt-in per project: ${PREFIX}_FACEBOOK_CROSSPOST=1 (or global FACEBOOK_CROSSPOST).
// Never throws fatally to the caller — IG success must not be undone by FB.

const GRAPH_API = "https://graph.facebook.com/v21.0";

export function facebookCrosspostEnabled(project: ProjectConfig): boolean {
  const v = brandEnvByPrefix(project.agent.gatewayEnvPrefix, "FACEBOOK_CROSSPOST", "FACEBOOK_CROSSPOST");
  return /^(1|true|yes)$/i.test(v ?? "");
}

async function fbPost(
  path: string,
  params: Record<string, string>,
): Promise<{ id?: string; post_id?: string; error?: { message?: string } }> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${GRAPH_API}${path}`, { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { id?: string; post_id?: string; error?: { message?: string } };
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

// Resolve the Page id + Page access token from the project's Meta token.
async function resolvePage(project: ProjectConfig): Promise<{ pageId: string; pageToken: string } | null> {
  const token = brandEnv(project, "INSTAGRAM_ACCESS_TOKEN");
  if (!token) return null;
  const res = await fetch(
    `${GRAPH_API}/me/accounts?fields=id,name,access_token&access_token=${token}`,
    { cache: "no-store" },
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => null)) as { data?: Array<{ id: string; access_token?: string }> } | null;
  const wantedId = process.env[`${project.agent.gatewayEnvPrefix}_FACEBOOK_PAGE_ID`];
  const page = wantedId ? j?.data?.find((p) => p.id === wantedId) : j?.data?.[0];
  if (!page?.id || !page.access_token) return null;
  return { pageId: page.id, pageToken: page.access_token };
}

export type FbPublishResult =
  | { ok: true; postId: string; permalink?: string }
  | { ok: false; error: string };

export type FbPostInput = {
  type: "IMAGE" | "CAROUSEL" | "REELS";
  caption: string;
  mediaUrls: string[]; // public URLs (hosted), same ones IG used
};

/**
 * Cross-publish an asset to the Facebook Page. IMAGE → /photos; CAROUSEL →
 * unpublished /photos then /feed with attached_media; REELS/VIDEO → /videos
 * with a hosted file_url (FB fetches + processes asynchronously).
 */
export async function publishFacebookPost(
  project: ProjectConfig,
  input: FbPostInput,
): Promise<FbPublishResult> {
  try {
    const page = await resolvePage(project);
    if (!page) return { ok: false, error: "No Facebook Page resolvable from the Meta token." };
    const { pageId, pageToken } = page;
    const caption = input.caption ?? "";
    const urls = input.mediaUrls.filter(Boolean);
    if (urls.length === 0) return { ok: false, error: "No media URL to publish." };

    if (input.type === "REELS") {
      // Post the video to the Page feed by hosted URL (FB downloads + transcodes).
      const r = await fbPost(`/${pageId}/videos`, { file_url: urls[0], description: caption, access_token: pageToken });
      const id = r.id ?? "";
      return { ok: true, postId: id, permalink: id ? `https://facebook.com/${id}` : undefined };
    }

    if (input.type === "CAROUSEL" && urls.length > 1) {
      // Upload each photo unpublished, then attach to a single feed post.
      const fbids: string[] = [];
      for (const url of urls.slice(0, 10)) {
        const up = await fbPost(`/${pageId}/photos`, { url, published: "false", access_token: pageToken });
        if (up.id) fbids.push(up.id);
      }
      if (!fbids.length) return { ok: false, error: "Facebook rejected all carousel photos." };
      const attached = JSON.stringify(fbids.map((id) => ({ media_fbid: id })));
      const feed = await fbPost(`/${pageId}/feed`, { message: caption, attached_media: attached, access_token: pageToken });
      const id = feed.id ?? feed.post_id ?? "";
      return { ok: true, postId: id, permalink: id ? `https://facebook.com/${id}` : undefined };
    }

    // Single image.
    const r = await fbPost(`/${pageId}/photos`, { url: urls[0], caption, access_token: pageToken });
    const id = r.post_id ?? r.id ?? "";
    return { ok: true, postId: id, permalink: id ? `https://facebook.com/${id}` : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
