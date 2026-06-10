// Shared between server (team-messaging) and client (team-view) — no
// "server-only" here on purpose.

/** Platforms coworkers can add from the member card — the set useful to the agent. */
export const CONTACT_PLATFORMS = [
  "Email",
  "Telegram",
  "WhatsApp",
  "Farcaster",
  "Instagram",
  "X",
  "GitHub",
  "Discord",
  "Website",
] as const;

export type ContactPlatform = (typeof CONTACT_PLATFORMS)[number];
