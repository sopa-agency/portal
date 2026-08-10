// Generatable campaign artifact kinds + their per-channel writing specs. Kept in
// a plain module (NOT the "use server" campaigns.ts, which may only export async
// functions) so both the server action and the client menu can import it.

export type GeneratableArtifactKind = "farcaster" | "hive" | "hive_mag" | "tweets" | "discord" | "binance";

// Minimal structural shape of the project fields the task prompts read — avoids
// importing server-only project code into the client bundle.
type ArtifactProject = {
  name: string;
  farcaster: { channel: string };
  hive: { account: string; community: string };
};

export const ARTIFACT_GEN_SPECS: Record<
  GeneratableArtifactKind,
  { label: string; nameBase: string; task: (p: ArtifactProject) => string }
> = {
  farcaster: {
    label: "Farcaster cast",
    nameBase: "Farcaster cast",
    task: (p) => `Write ONE Farcaster cast for the /${p.farcaster.channel} channel as @${p.hive.account}. Under 320 characters. Plain text. One short hook + the link. Emojis are fine. Write it in English.`,
  },
  hive: {
    label: "Hive snap",
    nameBase: "Hive snap",
    task: (p) => `Write ONE Hive snap (short post) to publish as a comment under peak.snaps' daily container on ${p.hive.community}. Plain text, real line breaks, under 280 characters when possible. Community voice. No hashtags in front. Write it in English.`,
  },
  hive_mag: {
    label: "Mag post (Hive blog)",
    nameBase: "Mag post",
    task: (p) => `Write ONE long-form Hive blog post (magazine style, ~300-600 words) ready to publish to ${p.hive.community} as @${p.hive.account}. Markdown with headings and paragraphs. Expand the core idea into a real read — context, the take, why it matters. Editorial, community-to-community, no corporate marketing-speak. This IS the publishable post body (no internal-brief sections). Write it in English.`,
  },
  tweets: {
    label: "Tweet thread",
    nameBase: "Tweet thread",
    task: (p) => `Write an X/Twitter thread of 3-5 tweets posted from @${p.hive.account}. The first opens with a hook + payoff and ends with a downward arrow. Each subsequent tweet stands on its own. Plain text, ONE tweet per paragraph (a blank line between tweets), each under 280 characters. Don't number them. Write it in English.`,
  },
  discord: {
    label: "Discord announcement",
    nameBase: "Discord announcement",
    task: (p) => `Write ONE message for the ${p.name} Discord #announcements channel. Start with @everyone or @community if appropriate. Discord markdown (**bold**, bullet lists). Include the relevant link(s). More casual than a tweet. Write it in English.`,
  },
  binance: {
    label: "Binance Square post",
    nameBase: "Binance Square post",
    task: (p) => `Write ONE Binance Square post (1-3 short paragraphs) for ${p.name}'s Binance Square feed. PLAIN TEXT ONLY — Binance REJECTS posts containing any URL or link, so include NONE (not even a mag post URL); no markdown either. Angle it for a crypto/onchain audience discovering ${p.name}. Write it in English.`,
  },
};

export const GENERATABLE_ARTIFACTS: { kind: GeneratableArtifactKind; label: string }[] = (
  Object.entries(ARTIFACT_GEN_SPECS) as [GeneratableArtifactKind, (typeof ARTIFACT_GEN_SPECS)[GeneratableArtifactKind]][]
).map(([kind, s]) => ({ kind, label: s.label }));
