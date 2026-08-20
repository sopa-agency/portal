"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession, authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { brandEnv } from "@/lib/brand-env";
import { prisma } from "@/lib/prisma";

export type DiscordChannel = { id: string; name: string };

const headersFor = (token: string) => ({ Authorization: `Bot ${token}`, "Content-Type": "application/json" });

/** Text/announcement channels of the bot's guild, plus the project's current default. */
export async function listDiscordChannels(): Promise<
  { ok: true; channels: DiscordChannel[]; currentId: string | null; envId: string | null } | { ok: false; error: string }
> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Unauthorized." };
  const token = brandEnv(project, "DISCORD_BOT_TOKEN");
  if (!token) return { ok: false, error: `Discord não configurado — defina ${project.agent.gatewayEnvPrefix}_DISCORD_BOT_TOKEN.` };

  const saved = await prisma.discordChannelConfig.findUnique({ where: { projectSlug: project.slug } }).catch(() => null);
  const envId = brandEnv(project, "DISCORD_CHANNEL_ID") ?? project.discord?.channelId ?? null;
  const currentId = saved?.channelId ?? envId;

  try {
    // Resolve the guild: from the current channel if known, else the bot's first guild.
    let guildId: string | undefined;
    if (currentId) {
      const ch = await fetch(`https://discord.com/api/v10/channels/${currentId}`, { headers: headersFor(token), signal: AbortSignal.timeout(9000) });
      if (ch.ok) guildId = ((await ch.json()) as { guild_id?: string }).guild_id;
    }
    if (!guildId) {
      const g = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers: headersFor(token), signal: AbortSignal.timeout(9000) });
      if (g.ok) guildId = ((await g.json()) as { id: string }[])[0]?.id;
    }
    if (!guildId) return { ok: false, error: "Bot não está em nenhum servidor (guild)." };

    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers: headersFor(token), signal: AbortSignal.timeout(9000) });
    if (!res.ok) return { ok: false, error: `Discord API HTTP ${res.status}` };
    const raw = (await res.json()) as { id: string; name: string; type: number; position: number }[];
    const channels = raw
      .filter((c) => c.type === 0 || c.type === 5) // text + announcement
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name }));
    return { ok: true, channels, currentId, envId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao listar canais." };
  }
}

/** Save the project's default Discord channel (admins). */
export async function saveDiscordChannel(channelId: string, channelName?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who || (who.role !== "admin" && !who.global)) return { ok: false, error: "Apenas admins definem o canal." };
  const id = channelId.trim();
  if (!/^\d{17,20}$/.test(id)) return { ok: false, error: "Channel ID inválido." };
  await prisma.discordChannelConfig.upsert({
    where: { projectSlug: project.slug },
    update: { channelId: id, channelName: channelName ?? null, updatedBy: who.username },
    create: { projectSlug: project.slug, channelId: id, channelName: channelName ?? null, updatedBy: who.username },
  });
  return { ok: true };
}
