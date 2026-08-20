"use server";

import { getActiveProject } from "@/projects/index";
import { brandEnv } from "@/lib/brand-env";

export type ServerEmoji = {
  name: string;
  id: string;
  animated: boolean;
  /** Discord CDN image for the picker preview. */
  url: string;
  /** What to insert into the message so Discord renders it: <:name:id>. */
  syntax: string;
};

// Guild emoji lists barely change — cache per guild for a few minutes so opening
// the picker repeatedly doesn't hammer the Discord API.
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; emojis: ServerEmoji[] }>();

/** Fetch the active project's Discord server custom emojis (the bot must be in
 *  that guild). Returns [] when Discord isn't configured or on any error. */
export async function getServerEmojis(): Promise<{ ok: boolean; emojis: ServerEmoji[]; error?: string }> {
  try {
    const project = await getActiveProject();
    const token = brandEnv(project, "DISCORD_BOT_TOKEN");
    const channelId = brandEnv(project, "DISCORD_CHANNEL_ID") ?? project.discord?.channelId;
    if (!token || !channelId) return { ok: true, emojis: [] };

    const headers = { Authorization: `Bot ${token}` };

    const cached = cache.get(channelId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { ok: true, emojis: cached.emojis };
    }

    // channel → guild
    const chRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers });
    if (!chRes.ok) return { ok: false, emojis: [], error: `channel lookup ${chRes.status}` };
    const guildId = ((await chRes.json()) as { guild_id?: string }).guild_id;
    if (!guildId) return { ok: true, emojis: [] };

    const emRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/emojis`, { headers });
    if (!emRes.ok) return { ok: false, emojis: [], error: `emoji fetch ${emRes.status}` };
    const raw = (await emRes.json()) as { id: string; name: string; animated?: boolean }[];

    const emojis: ServerEmoji[] = (Array.isArray(raw) ? raw : [])
      .filter((e) => e.id && e.name)
      .map((e) => ({
        name: e.name,
        id: e.id,
        animated: !!e.animated,
        url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=48`,
        syntax: `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
      }));

    cache.set(channelId, { at: Date.now(), emojis });
    return { ok: true, emojis };
  } catch (err) {
    return { ok: false, emojis: [], error: err instanceof Error ? err.message : String(err) };
  }
}
