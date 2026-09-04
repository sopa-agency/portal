// Pure campaign-document classification — shared by the (client) preview and
// (server) campaign list so completion can be computed without client imports.

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

export function classifyCampaignDocument(name: string, isMain: boolean): CampaignDocumentKind {
  if (isMain) return "brief";
  const lower = name.toLowerCase();
  // The Portuguese translation rides in the mag post's json_metadata — it's a
  // plain doc, not separately publishable.
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

/** Kinds that represent a publishable channel artifact (count toward "done"). */
export const PUBLISHABLE_KINDS = new Set<CampaignDocumentKind>([
  "hive",
  "hive_mag",
  "farcaster",
  "tweets",
  "discord",
  "binance",
  "instagram",
  "email",
  "paragraph",
]);

export function isPublishableKind(kind: CampaignDocumentKind): boolean {
  return PUBLISHABLE_KINDS.has(kind);
}

/** Completion of a campaign by how many of its publishable artifacts were posted. */
export function campaignProgress(docs: { name: string; isMain: boolean; postedAt: Date | string | null }[]): {
  posted: number;
  total: number;
} {
  let posted = 0;
  let total = 0;
  for (const d of docs) {
    if (!isPublishableKind(classifyCampaignDocument(d.name, d.isMain))) continue;
    total++;
    if (d.postedAt) posted++;
  }
  return { posted, total };
}
