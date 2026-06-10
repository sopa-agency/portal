"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects/index";
import {
  publishSnapToHive,
  publishCastToFarcaster,
  publishToDiscord,
} from "@/lib/social-publish";
import { sendProjectEmail } from "@/lib/email";
import {
  getTeamMessageOptions,
  mergeEmailContact,
  type TeamMessageChannel,
  type TeamMessageOption,
} from "@/lib/team-messaging";
import { prisma } from "@/lib/prisma";
import type { TeamContact } from "@/projects/types";

const MAX_MESSAGE_LENGTH = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UpdateTeamMemberEmailResult =
  | { ok: true; contacts: TeamContact[]; messageOptions: TeamMessageOption[] }
  | { ok: false; error: string };

/**
 * Set (or clear, with an empty string) a team member's email. Any allowlisted
 * member of the portal can edit any other member's email — it's shared team
 * contact data. Stored per (project, member) and overrides the static config.
 */
export async function updateTeamMemberEmail(input: {
  username: string;
  email: string;
}): Promise<UpdateTeamMemberEmailResult> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    const username = input.username.toLowerCase().trim();
    if (!project.allowlist.includes(username)) {
      return { ok: false, error: "Unknown team member." };
    }

    const email = input.email.trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "That doesn't look like a valid email address." };
    }

    if (email) {
      await prisma.teamMemberEmail.upsert({
        where: { projectSlug_username: { projectSlug: project.slug, username } },
        create: { projectSlug: project.slug, username, email, updatedBy: session.username },
        update: { email, updatedBy: session.username },
      });
    } else {
      // Clearing the override falls back to the static config email (if any).
      await prisma.teamMemberEmail.deleteMany({
        where: { projectSlug: project.slug, username },
      });
    }

    const emailOverride = email || undefined;
    return {
      ok: true,
      contacts: mergeEmailContact(project.teamContacts?.[username] ?? [], emailOverride),
      messageOptions: getTeamMessageOptions(project, username, { emailOverride }),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update email." };
  }
}

export type SendTeamMessageResult =
  | { ok: true; url?: string }
  | { ok: false; error: string };

/**
 * Send a message to a team member over one of the channels the portal can
 * actually deliver on. Targets are resolved server-side from the project's
 * teamContacts — the client only picks a channel.
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
    if (!project.allowlist.includes(username)) {
      return { ok: false, error: "Unknown team member." };
    }

    const message = input.message.trim();
    if (!message) return { ok: false, error: "Message is empty." };
    if (message.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters).` };
    }

    const option = getTeamMessageOptions(project, username).find(
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
        const r = await publishToDiscord(
          `**→ ${username}:** ${message}\n-# ${signature}`,
          project,
        );
        return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error };
      }
      case "email": {
        const subject = `Message from @${session.username} — ${project.name} portal`;
        const html = `<p style="white-space:pre-wrap;">${message
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p><p style="color:#888;font-size:13px;">${signature}</p>`;
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
