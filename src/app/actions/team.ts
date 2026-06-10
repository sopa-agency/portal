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
  type TeamMessageChannel,
} from "@/lib/team-messaging";

const MAX_MESSAGE_LENGTH = 2000;

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
