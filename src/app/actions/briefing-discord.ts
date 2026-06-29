"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject, getProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";
import { loadLatestBriefing } from "@/lib/morning-briefing";
import { publishToDiscord } from "@/lib/social-publish";
import { callOpenClaw } from "@/lib/openclaw-gateway";
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

/** Produce a Discord-friendly EN + PT version of the briefing (no AI → raw body). */
async function bilingual(project: ProjectConfig, agentSlug: string, body: string): Promise<{ en: string; pt: string }> {
  const prompt =
    `Resuma este morning briefing de skate num post curto e direto pro Discord, em DOIS idiomas. ` +
    `Responda EXATAMENTE neste formato, sem mais nada:\n===EN===\n<inglês>\n===PT===\n<português>\n\n` +
    `Mantenha bullets, sem preâmbulo, no máximo ~1400 caracteres por idioma.\n\nBRIEFING:\n${body.slice(0, 6000)}`;
  const out = await callOpenClaw(prompt, agentSlug, { project, timeoutMs: 90_000 }).catch(() => "");
  const [enRaw, ptRaw] = out.split(/===\s*PT\s*===/i);
  const en = (enRaw || "").replace(/===\s*EN\s*===/i, "").trim();
  const pt = (ptRaw || "").trim();
  return { en: en || body, pt: pt || en || body };
}

/**
 * Post a morning briefing to a Discord server. SkateHive splits it bilingually
 * (English → #important, Portuguese → #chat); the other brand servers post one
 * Portuguese message to their configured channel.
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

  const header = `🛹 **${agent.label}** · ${r.briefing.date}`;
  const { en, pt } = await bilingual(project, agent.slug, r.briefing.rawBody);
  const posted: string[] = [];

  if (server === "skatehive") {
    const ch = await resolveChannels(target);
    const important = findChannel(ch, "important", "importante");
    const chat = findChannel(ch, "chat", "general", "geral");
    if (important) { if ((await publishToDiscord(`${header} 🇬🇧\n\n${en}`, target, important)).ok) posted.push("#important (EN)"); }
    if (chat) { if ((await publishToDiscord(`${header} 🇧🇷\n\n${pt}`, target, chat)).ok) posted.push("#chat (PT)"); }
    if (!important && !chat) { if ((await publishToDiscord(`${header}\n\n${pt}`, target)).ok) posted.push("canal padrão (PT)"); }
  } else {
    // gnars / reelflip — one room, Portuguese, the project's configured channel.
    const res = await publishToDiscord(`${header}\n\n${pt}`, target);
    if (res.ok) posted.push(`${target.name} (PT)`);
    else return { ok: false, error: res.error || "Falha ao postar no Discord." };
  }

  if (!posted.length) return { ok: false, error: "Nenhum canal recebeu o post — confira o token e os canais (#important/#chat)." };
  return { ok: true, detail: `Enviado: ${posted.join(", ")}` };
}
