"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession, getAccess } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import {
  publishSnapToHive,
  publishCastToFarcaster,
  publishToDiscord,
} from "@/lib/social-publish";
import { sendProjectEmail } from "@/lib/email";
import {
  CONTACT_PLATFORMS,
  getTeamMessageOptions,
  mergeContacts,
  resolveCrossPortalContacts,
  type ContactPlatform,
  type TeamMessageChannel,
  type TeamMessageOption,
} from "@/lib/team-messaging";
import { prisma } from "@/lib/prisma";
import type { ProjectConfig, TeamContact } from "@/projects/types";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTACT_LENGTH = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Merged (config + DB) contacts for one member. */
async function loadMemberContacts(
  project: ProjectConfig,
  username: string,
): Promise<TeamContact[]> {
  // Fetch this member's rows across ALL portals so contacts entered elsewhere
  // (email, socials) fall back in here — the current portal still takes priority.
  const rows = await prisma.teamMemberContact.findMany({
    where: { username },
  });
  const overrides = resolveCrossPortalContacts(rows, project.slug).get(username) ?? [];
  return mergeContacts(project.teamContacts?.[username] ?? [], overrides);
}

export type UpdateTeamMemberContactResult =
  | { ok: true; contacts: TeamContact[]; messageOptions: TeamMessageOption[] }
  | { ok: false; error: string };

/**
 * Set (or clear, with an empty value) one of a team member's contacts. Any
 * allowlisted member of the portal can edit any other member's contacts —
 * it's shared team data the agent uses to reach people.
 */
export async function updateTeamMemberContact(input: {
  username: string;
  label: string;
  value: string;
}): Promise<UpdateTeamMemberContactResult> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    const username = input.username.toLowerCase().trim();
    const access = await getAccess(username, project);
    if (!access.allowed) {
      return { ok: false, error: "Unknown team member." };
    }

    const label = input.label.trim() as ContactPlatform;
    if (!CONTACT_PLATFORMS.includes(label)) {
      return { ok: false, error: "Unknown contact platform." };
    }

    const value = input.value.trim();
    if (value.length > MAX_CONTACT_LENGTH) {
      return { ok: false, error: `Too long (max ${MAX_CONTACT_LENGTH} characters).` };
    }
    if (value && label === "Email" && !EMAIL_RE.test(value.toLowerCase())) {
      return { ok: false, error: "That doesn't look like a valid email address." };
    }
    // Discord stores the numeric USER ID (snowflake), not the username — IDs
    // are stable, and let the bot resolve the profile and @mention the member.
    if (value && label === "Discord" && !/^\d{17,20}$/.test(value)) {
      return {
        ok: false,
        error:
          "Use the Discord user ID (numbers only). In Discord: Settings → Advanced → Developer Mode ON, then right-click the user → Copy User ID.",
      };
    }
    // Wallet = an EVM address for bounty payouts.
    if (value && label === "Wallet" && !/^0x[a-fA-F0-9]{40}$/.test(value.trim())) {
      return { ok: false, error: "Endereço de carteira inválido (use um endereço EVM 0x…)." };
    }

    if (value) {
      await prisma.teamMemberContact.upsert({
        where: {
          projectSlug_username_label: { projectSlug: project.slug, username, label },
        },
        create: {
          projectSlug: project.slug,
          username,
          label,
          value: label === "Email" ? value.toLowerCase() : value,
          updatedBy: session.username,
        },
        update: {
          value: label === "Email" ? value.toLowerCase() : value,
          updatedBy: session.username,
        },
      });
    } else {
      // Clearing the override falls back to the static config contact (if any).
      await prisma.teamMemberContact.deleteMany({
        where: { projectSlug: project.slug, username, label },
      });
    }

    const contacts = await loadMemberContacts(project, username);
    return {
      ok: true,
      contacts,
      messageOptions: getTeamMessageOptions(project, username, { contacts }),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update contact." };
  }
}

export type ResolveDiscordUserResult =
  | { ok: true; username: string; displayName: string | null; avatarUrl: string }
  | { ok: false; error: string };

/**
 * Resolve a Discord user ID to username + avatar via the project's bot.
 * Best-effort UI sugar for the contact card — failures just mean the chip
 * doesn't render.
 */
export async function resolveDiscordUser(userId: string): Promise<ResolveDiscordUserResult> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    const id = userId.trim();
    if (!/^\d{17,20}$/.test(id)) return { ok: false, error: "Not a Discord user id." };

    const token =
      (project.agent.gatewayEnvPrefix
        ? process.env[`${project.agent.gatewayEnvPrefix}_DISCORD_BOT_TOKEN`]
        : undefined) ?? process.env.DISCORD_BOT_TOKEN;
    if (!token) return { ok: false, error: "No Discord bot configured." };

    const res = await fetch(`https://discord.com/api/v10/users/${id}`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "DiscordBot (https://reelflip.com, 1.0) portal-contact-resolver",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { ok: false, error: `Discord HTTP ${res.status}` };
    const u = (await res.json()) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    };
    const avatarUrl = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> BigInt(22)) % BigInt(6))}.png`;
    return { ok: true, username: u.username, displayName: u.global_name ?? null, avatarUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "resolve failed" };
  }
}

export type SendTeamMessageResult =
  | { ok: true; url?: string }
  | { ok: false; error: string };

/**
 * Send a message to a team member over one of the channels the portal can
 * actually deliver on. Targets are resolved server-side from the project's
 * teamContacts + coworker-edited contacts — the client only picks a channel.
 */
export async function sendTeamMessage(input: {
  username: string;
  channel: TeamMessageChannel;
  message: string;
}): Promise<SendTeamMessageResult> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    const username = input.username.toLowerCase().trim();
    const access = await getAccess(username, project);
    if (!access.allowed) {
      return { ok: false, error: "Unknown team member." };
    }

    const message = input.message.trim();
    if (!message) return { ok: false, error: "Message is empty." };
    if (message.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters).` };
    }

    const contacts = await loadMemberContacts(project, username);
    const option = getTeamMessageOptions(project, username, { contacts }).find(
      (o) => o.channel === input.channel,
    );
    if (!option) {
      return { ok: false, error: "That channel isn't available for this member." };
    }

    const signature = `— @${session.username} via the ${project.name} portal`;

    switch (option.channel) {
      case "hive": {
        const r = await publishSnapToHive(`@${username}, ${message}\n\n${signature}`, project);
        return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error };
      }
      case "farcaster": {
        const r = await publishCastToFarcaster(
          `${option.target} ${message}\n\n${signature}`,
          project,
        );
        return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error };
      }
      case "discord": {
        // With a stored Discord user ID the channel post becomes a real
        // @mention (pings the member); otherwise fall back to the username.
        const discordId = contacts.find((c) => c.label === "Discord")?.value;
        const mention = discordId && /^\d{17,20}$/.test(discordId) ? `<@${discordId}>` : username;
        const r = await publishToDiscord(
          `**→ ${mention}:** ${message}\n-# ${signature}`,
          project,
        );
        return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error };
      }
      case "email": {
        const subject = `Message from @${session.username} — ${project.name} portal`;
        // Escape, then autolink http(s) URLs so Kanban-card / post links in the
        // draft are clickable in the delivered email (plain text isn't).
        const escaped = message
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
        const html = `<p style="white-space:pre-wrap;">${escaped}</p><p style="color:#888;font-size:13px;">${signature}</p>`;
        const r = await sendProjectEmail(project, {
          to: option.target,
          subject,
          html,
          text: `${message}\n\n${signature}`,
        });
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send." };
  }
}
