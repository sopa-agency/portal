"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject, getProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";
import { loadLatestBriefing } from "@/lib/morning-briefing";
import { publishToDiscord } from "@/lib/social-publish";
import { brandEnv } from "@/lib/brand-env";

export type DiscordServerKey = "skatehive" | "gnars" | "reelflip";

// channel name → id, per server's bot guild (cached in-process).
const _chanCache = new Map<string, { ids: Record<string, string>; expires: number }>();
async function resolveChannels(project: ProjectConfig): Promise<Record<string, string>> {
  const token = brandEnv(project, "DISCORD_BOT_TOKEN");
  if (!token) return {};
  const cached = _chanCache.get(project.slug);
  if (cached && Date.now() < cached.expires) return cached.ids;
  const headers = { Authorization: `Bot ${token}` };
  try {
    const gRes = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers, signal: AbortSignal.timeout(9000) });
    const guilds = (await gRes.json()) as { id: string }[];
    const guildId = Array.isArray(guilds) ? guilds[0]?.id : undefined;
    if (!guildId) return {};
    const cRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers, signal: AbortSignal.timeout(9000) });
    const raw = (await cRes.json()) as { id: string; name: string; type: number }[];
    const ids: Record<string, string> = {};
    for (const c of raw) if ((c.type === 0 || c.type === 5) && c.name) ids[c.name.toLowerCase()] = c.id;
    _chanCache.set(project.slug, { ids, expires: Date.now() + 10 * 60 * 1000 });
    return ids;
  } catch {
    return {};
  }
}
const findChannel = (ids: Record<string, string>, ...names: string[]) => {
  for (const n of names) { const id = ids[n.toLowerCase().replace(/^#/, "")]; if (id) return id; }
  return null;
};

/**
 * Post a morning briefing to a Discord server — the RAW briefing markdown, as
 * is, no AI/summarization. SkateHive posts it to #important and #chat; the other
 * brand servers post to their configured channel. publishToDiscord chunks it to
 * Discord's 2000-char limit.
 */
export async function sendBriefingToDiscord(
  agentSlug: string,
  server: DiscordServerKey,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Unauthorized." };

  const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
  if (!agent) return { ok: false, error: "Briefing não encontrado neste portal." };
  const r = await loadLatestBriefing(agent);
  if (!r.ok) return { ok: false, error: r.error || "Briefing indisponível." };

  let target: ProjectConfig;
  try { target = getProject(server); } catch { return { ok: false, error: `Servidor ${server} desconhecido.` }; }
  if (!brandEnv(target, "DISCORD_BOT_TOKEN")) {
    return { ok: false, error: `Discord do ${target.name} não configurado (falta ${target.agent.gatewayEnvPrefix}_DISCORD_BOT_TOKEN).` };
  }

  // The exact morning-briefing markdown — posted verbatim, no processing.
  const message = `🛹 **${agent.label}** · ${r.briefing.date}\n\n${r.briefing.rawBody}`;
  const posted: string[] = [];

  if (server === "skatehive") {
    const ch = await resolveChannels(target);
    const important = findChannel(ch, "important", "importante");
    const chat = findChannel(ch, "chat", "general", "geral");
    if (important && (await publishToDiscord(message, target, important)).ok) posted.push("#important");
    if (chat && (await publishToDiscord(message, target, chat)).ok) posted.push("#chat");
    if (!important && !chat && (await publishToDiscord(message, target)).ok) posted.push("canal padrão");
  } else {
    // gnars / reelflip — one room, the project's configured channel.
    const res = await publishToDiscord(message, target);
    if (res.ok) posted.push(target.name);
    else return { ok: false, error: res.error || "Falha ao postar no Discord." };
  }

  if (!posted.length) return { ok: false, error: "Nenhum canal recebeu o post — confira o token e os canais (#important/#chat)." };
  return { ok: true, detail: `Enviado: ${posted.join(", ")}` };
}
