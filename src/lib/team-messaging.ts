import "server-only";

import type { ProjectConfig, TeamContact } from "@/projects/types";
import { isEmailConfigured } from "@/lib/email";

// ---------------------------------------------------------------------------
// Team member contacts (coworker-editable, TeamMemberContact rows) + which
// channels can actually DELIVER a message to a member. Presence-only env
// checks — never expose secret values.
// ---------------------------------------------------------------------------

export { CONTACT_PLATFORMS, type ContactPlatform } from "@/lib/contact-platforms";
import { CONTACT_PLATFORMS, type ContactPlatform } from "@/lib/contact-platforms";
import { brandEnvByPrefix } from "@/lib/brand-env";

export type TeamMessageChannel = "hive" | "farcaster" | "discord" | "email";

export type TeamMessageOption = {
  channel: TeamMessageChannel;
  /** Where the message lands, e.g. "@xvlad" or "vlad@example.com". */
  target: string;
  visibility: "public" | "private";
};

/** Derive the clickable URL for a stored contact value, when there is one. */
export function buildContactUrl(label: string, value: string): string | undefined {
  const v = value.trim();
  const handle = v.replace(/^@/, "");
  switch (label.toLowerCase()) {
    case "email":
      return `mailto:${v}`;
    case "telegram":
      return `https://t.me/${handle}`;
    case "whatsapp":
      return `https://wa.me/${v.replace(/[^\d]/g, "")}`;
    case "farcaster":
      return `https://farcaster.xyz/${handle}`;
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "x":
    case "twitter":
      return `https://x.com/${handle}`;
    case "github":
      return `https://github.com/${handle}`;
    case "website":
      return /^https?:\/\//i.test(v) ? v : `https://${v}`;
    case "discord":
      return undefined; // username only — no public profile URL
    default:
      return undefined;
  }
}

/**
 * Merge coworker-edited contacts (TeamMemberContact rows) into a member's
 * static config contacts. DB rows win on matching label (case-insensitive);
 * new labels are appended in CONTACT_PLATFORMS order.
 */
export function mergeContacts(
  configContacts: TeamContact[],
  overrides: { label: string; value: string }[],
): TeamContact[] {
  if (overrides.length === 0) return configContacts;
  const overridden = new Set(overrides.map((o) => o.label.toLowerCase()));
  const kept = configContacts.filter((c) => !overridden.has(c.label.toLowerCase()));
  const added: TeamContact[] = [...overrides]
    .sort(
      (a, b) =>
        CONTACT_PLATFORMS.indexOf(a.label as ContactPlatform) -
        CONTACT_PLATFORMS.indexOf(b.label as ContactPlatform),
    )
    .map((o) => ({ label: o.label, value: o.value, url: buildContactUrl(o.label, o.value) }));
  return [...kept, ...added];
}

function findContact(contacts: TeamContact[], labelMatch: string): string | undefined {
  return contacts.find((c) => c.label.toLowerCase().includes(labelMatch))?.value;
}

/**
 * Channels that can deliver to this member. Pass the MERGED contacts (config
 * + DB) via opts.contacts — falls back to config-only when omitted.
 */
export function getTeamMessageOptions(
  project: ProjectConfig,
  username: string,
  opts?: { contacts?: TeamContact[] },
): TeamMessageOption[] {
  const contacts = opts?.contacts ?? project.teamContacts?.[username] ?? [];
  const prefix = project.agent.gatewayEnvPrefix;
  const options: TeamMessageOption[] = [];

  // Hive snap — every member IS a Hive account; needs a posting key
  // (per-project or the global fallback, same resolution as publishSnapToHive).
  const hiveKey = brandEnvByPrefix(prefix, "HIVE_POSTING_KEY");
  if (hiveKey) {
    options.push({ channel: "hive", target: `@${username}`, visibility: "public" });
  }

  // Farcaster cast — needs the member's Farcaster handle + a project signer.
  const farcasterHandle = findContact(contacts, "farcaster");
  const neynarKey =
    (prefix && process.env[`${prefix}_NEYNAR_API_KEY`]) ||
    process.env.NEYNAR_API_KEY;
  const signerUuid = brandEnvByPrefix(prefix, "NEYNAR_SIGNER_UUID");
  if (farcasterHandle && neynarKey && signerUuid) {
    const handle = farcasterHandle.startsWith("@") ? farcasterHandle : `@${farcasterHandle}`;
    options.push({ channel: "farcaster", target: handle, visibility: "public" });
  }

  // Discord — posts to the project's announcement/chat channel (no DM: we
  // don't store members' Discord user ids).
  const discordToken = brandEnvByPrefix(prefix, "DISCORD_BOT_TOKEN");
  const discordChannel = brandEnvByPrefix(prefix, "DISCORD_CHANNEL_ID");
  if (discordToken && discordChannel) {
    options.push({ channel: "discord", target: "project channel", visibility: "public" });
  }

  // Email — private; needs the member's email contact + project SMTP.
  const email = findContact(contacts, "email");
  if (email && isEmailConfigured(project)) {
    options.push({ channel: "email", target: email, visibility: "private" });
  }

  // Private channels first — they're the default pick in the composer.
  return options.sort((a, b) =>
    a.visibility === b.visibility ? 0 : a.visibility === "private" ? -1 : 1,
  );
}
