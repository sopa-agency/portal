"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

// A Farcaster channel as returned by Neynar channel search — enough to render a
// searchable picker for choosing which channel a campaign cast posts to. Unlike
// Discord (a fixed guild channel list), Farcaster channels are an open universe,
// so the picker searches live rather than listing everything.
export type FarcasterChannel = { id: string; name: string; imageUrl?: string; followerCount?: number };

// Live channel search via Neynar. An empty query returns no channels but still
// the project's default channel id, so the picker can pre-select it on mount.
export async function searchFarcasterChannels(q: string): Promise<
  { ok: true; channels: FarcasterChannel[]; defaultId: string } | { ok: false; error: string }
> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Unauthorized." };

  const prefix = project.agent.gatewayEnvPrefix;
  const apiKey = process.env[`${prefix}_NEYNAR_API_KEY`] || process.env.NEYNAR_API_KEY;
  if (!apiKey) return { ok: false, error: `Neynar não configurado — defina ${prefix}_NEYNAR_API_KEY.` };

  const defaultId = project.farcaster.channel ?? "";
  const query = q.trim();
  if (!query) return { ok: true, channels: [], defaultId };

  try {
    const res = await fetch(
      `https://api.neynar.com/v2/farcaster/channel/search?q=${encodeURIComponent(query)}&limit=10`,
      { headers: { "x-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return { ok: false, error: `Neynar HTTP ${res.status}` };
    const json = (await res.json()) as {
      channels?: { id: string; name?: string; image_url?: string; follower_count?: number }[];
    };
    const channels = (json.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      imageUrl: c.image_url,
      followerCount: c.follower_count,
    }));
    return { ok: true, channels, defaultId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
