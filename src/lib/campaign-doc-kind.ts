/**
 * What a campaign artifact IS, derived from its name, and which publishing
 * network (if any) that maps to.
 *
 * Lives here rather than inside the campaigns actions module because two very
 * different callers need it: the campaign UI ("can I schedule this?") and the
 * scheduler ("what do I publish this as?"). The actions module is `"use server"`,
 * so a plain sync helper cannot be exported from it — and a second copy of this
 * classifier would drift from the first the day someone adds a network.
 */
export type CampaignDocumentKind =
  | "brief"
  | "hive"
  | "hive_mag"
  | "farcaster"
  | "tweets"
  | "discord"
  | "binance"
  | "instagram"
  | "email"
  | "paragraph"
  | "markdown"
  | "doc";

/**
 * ORDER MATTERS — these are substring tests, and the first match wins. "Hive mag
 * post" has to be caught before the "hive" rule, and the catch-all "post" rule
 * has to stay last or it would swallow half the names above it.
 */
export function classifyDocumentKindByName(name: string): CampaignDocumentKind {
  const lower = name.toLowerCase();
  if (lower.includes("mag post") && lower.includes("(pt)")) return "doc";
  if (lower.includes("mag post") || lower.includes("magazine")) return "hive_mag";
  if (lower.includes("hive") || lower.includes("snap")) return "hive";
  if (lower.includes("farcaster") || lower.includes("cast") || lower.includes("warpcast")) return "farcaster";
  if (lower.includes("tweet") || lower.includes("twitter") || lower.includes("x thread")) return "tweets";
  if (lower.includes("discord")) return "discord";
  if (lower.includes("binance")) return "binance";
  if (lower.includes("instagram") || lower.includes("carousel") || lower.includes("carrossel")) return "instagram";
  if (lower.includes("email")) return "email";
  // Before the "post" catch-all below, which otherwise swallows
  // "Paragraph post" into `markdown` and hides its publish button.
  if (lower.includes("paragraph")) return "paragraph";
  if (lower.includes("markdown") || lower.includes("blog") || lower.includes("post")) return "markdown";
  return "doc";
}

/**
 * kind → the network key `publishLabChannel` dispatches on.
 *
 * A kind ABSENT here cannot be published by the machine at all — Twitter,
 * Instagram, a press release and a TV script are hand-delivered by a human.
 * That is a real property of the campaign, not an oversight: the calendar can
 * hold them, but the scheduler must skip them rather than fail on them.
 */
export const SCHEDULABLE_NETWORK: Partial<Record<CampaignDocumentKind, string>> = {
  hive: "hive",
  farcaster: "farcaster",
  discord: "discord",
  binance: "binance",
  hive_mag: "hive_mag",
  email: "email",
};

/** The network this artifact would publish to, or null if it is human-only. */
export function schedulableNetworkFor(name: string): string | null {
  return SCHEDULABLE_NETWORK[classifyDocumentKindByName(name)] ?? null;
}
