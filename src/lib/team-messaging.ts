import "server-only";

import type { ProjectConfig } from "@/projects/types";
import { isEmailConfigured } from "@/lib/email";

// ---------------------------------------------------------------------------
// Which channels can actually DELIVER a message to a given team member, based
// on the project's connected publishers + the member's known contacts.
// Presence-only env checks — never expose secret values.
// ---------------------------------------------------------------------------

export type TeamMessageChannel = "hive" | "farcaster" | "discord" | "email";

export type TeamMessageOption = {
  channel: TeamMessageChannel;
  /** Where the message lands, e.g. "@xvlad" or "vlad@example.com". */
  target: string;
  visibility: "public" | "private";
};

function contactValue(
  project: ProjectConfig,
  username: string,
  labelMatch: string,
): string | undefined {
  const list = project.teamContacts?.[username] ?? [];
  return list.find((c) => c.label.toLowerCase().includes(labelMatch))?.value;
}

export function getTeamMessageOptions(
  project: ProjectConfig,
  username: string,
): TeamMessageOption[] {
  const prefix = project.agent.gatewayEnvPrefix;
  const options: TeamMessageOption[] = [];

  // Hive snap — every member IS a Hive account; needs a posting key
  // (per-project or the global fallback, same resolution as publishSnapToHive).
  const hiveKey =
    (prefix && process.env[`${prefix}_HIVE_POSTING_KEY`]) ||
    process.env.HIVE_POSTING_KEY;
  if (hiveKey) {
    options.push({ channel: "hive", target: `@${username}`, visibility: "public" });
  }

  // Farcaster cast — needs the member's Farcaster handle + a project signer.
  const farcasterHandle = contactValue(project, username, "farcaster");
  const neynarKey =
    (prefix && process.env[`${prefix}_NEYNAR_API_KEY`]) ||
    process.env.NEYNAR_API_KEY;
  const signerUuid =
    (prefix && process.env[`${prefix}_NEYNAR_SIGNER_UUID`]) ||
    process.env.NEYNAR_SIGNER_UUID;
  if (farcasterHandle && neynarKey && signerUuid) {
    const handle = farcasterHandle.startsWith("@") ? farcasterHandle : `@${farcasterHandle}`;
    options.push({ channel: "farcaster", target: handle, visibility: "public" });
  }

  // Discord — posts to the project's announcement/chat channel (no DM: we
  // don't store members' Discord user ids).
  const discordToken =
    (prefix ? process.env[`${prefix}_DISCORD_BOT_TOKEN`] : undefined) ??
    process.env.DISCORD_BOT_TOKEN;
  const discordChannel =
    (prefix ? process.env[`${prefix}_DISCORD_CHANNEL_ID`] : undefined) ??
    process.env.DISCORD_CHANNEL_ID;
  if (discordToken && discordChannel) {
    options.push({ channel: "discord", target: "project channel", visibility: "public" });
  }

  // Email — private; needs the member's email contact + project SMTP.
  const email = contactValue(project, username, "email");
  if (email && isEmailConfigured(project)) {
    options.push({ channel: "email", target: email, visibility: "private" });
  }

  // Private channels first — they're the default pick in the composer.
  return options.sort((a, b) =>
    a.visibility === b.visibility ? 0 : a.visibility === "private" ? -1 : 1,
  );
}
