// Builds a ready-to-paste prompt for Claude Design (claude.ai/design) that turns
// a campaign's pieces into the campaign's image assets — one page per platform,
// at standard dimensions, in a consistent house style. This productizes what we
// otherwise do by hand: read the brief + pieces, then hand-write the design
// prompt. Pure + client-safe (no server imports) so the folder shell can build
// the string and copy it to the clipboard with zero round-trips.

import type { CampaignDocumentKind } from "@/lib/campaign-kind";

export type DesignPromptDoc = {
  name: string;
  content: string;
  kind: CampaignDocumentKind;
};

// Which piece kinds become an image, and the platform-standard spec for each.
// Kinds not listed (brief, doc, markdown) are internal/long-form and get no card.
const KIND_IMAGE_SPEC: Partial<
  Record<CampaignDocumentKind, { asset: string; dims: string; note?: string }>
> = {
  farcaster: { asset: "Social card (Farcaster)", dims: "1200×630" },
  hive: { asset: "Social card (Hive snap)", dims: "1200×630" },
  hive_mag: { asset: "Blog cover (Hive mag)", dims: "1200×630" },
  tweets: { asset: "Twitter/X image", dims: "1600×900", note: "hero framing; if the copy lists milestones or a roadmap, also make a matching 1600×900 infographic" },
  discord: { asset: "Discord announcement banner", dims: "1200×630", note: "loud rally energy, CTA visible" },
  binance: { asset: "Binance Square", dims: "1080×1080", note: "square; URL as plain text, not a clickable button" },
  instagram: { asset: "Instagram carousel", dims: "1080×1350 × up to 6 slides", note: "NORMIE voice — no crypto jargon; one idea per slide" },
  email: { asset: "Email hero", dims: "1200×600", note: "leave clean space for a headline overlay" },
};

// Pull the most-referenced URL across the pieces to use as the CTA (e.g.
// "gnars.com/stake" appears in most Stake-or-Die pieces). Falls back to the
// brand site.
function inferCta(docs: DesignPromptDoc[], fallback?: string): string {
  const counts = new Map<string, number>();
  const re = /\b((?:https?:\/\/)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s)"'<>]*)?)/gi;
  for (const d of docs) {
    for (const m of d.content.matchAll(re)) {
      const url = m[1].replace(/^https?:\/\//i, "").replace(/[.,)]+$/, "");
      if (!url.includes("/")) continue; // want a path, not a bare domain/handle
      if (/\.(png|jpe?g|svg|gif|webp)$/i.test(url)) continue; // skip image URLs
      counts.set(url, (counts.get(url) ?? 0) + 1);
    }
  }
  let best = fallback ?? "";
  let bestN = 0;
  for (const [url, n] of counts) if (n > bestN) [best, bestN] = [url, n];
  return best;
}

export function buildClaudeDesignPrompt(opts: {
  brandName?: string;
  accent?: string;
  documents: DesignPromptDoc[];
  /** Overrides the inferred CTA if provided. */
  cta?: string;
}): string {
  const brand = opts.brandName?.trim() || "the brand";
  const accent = opts.accent?.trim() || "#a3e635";
  const docs = opts.documents;
  const cta = (opts.cta?.trim() || inferCta(docs)) || `${brand} site`;

  // One image row per visual piece. PT variants ("(PT)") reuse the same spec but
  // keep their own copy, so the designer localizes without re-deriving layout.
  const rows: string[] = [];
  for (const d of docs) {
    const spec = KIND_IMAGE_SPEC[d.kind];
    if (!spec) continue;
    const copy = d.content.trim().replace(/\s+\n/g, "\n").slice(0, 600);
    rows.push(
      `### ${d.name} — ${spec.asset} · ${spec.dims}` +
        (spec.note ? `\n(${spec.note})` : "") +
        `\nCopy to base the art on:\n"""\n${copy}\n"""`,
    );
  }

  if (rows.length === 0) {
    return `This campaign has no visual pieces yet — generate posts (Farcaster, Instagram, Discord, etc.) first, then use this button.`;
  }

  return `You are working inside a claude.ai/design project. Create image assets for ${brand}'s campaign — one design "page" per asset below (use data-document-role="page" on each), matching ONE consistent house style across all of them. If this project already has a design file for this campaign, match it exactly instead of inventing a new look.

## House style (keep consistent across every asset)
- Background near-black (#0a0a0a). Brand accent ${accent}. White text, muted grey (#a3a3a3) for secondary.
- A bold display wordmark for the campaign name + a clean condensed sans for body copy. High contrast, legible at small/feed sizes.
- Optional film-grain/grit overlay for texture. Keep the brand's logo/mark and reuse any photography/cut-outs already in the project.
- Parametrize the CTA as an editable prop defaulting to "${cta}".

## Guardrails (do not violate)
- If the campaign references a protocol/partner, frame it as the brand BUILDING ON an open protocol — never "partnership / official / teamed up", never imply the other side agreed to anything. Any commitment shown is the brand's own.
- Never put internal figures (treasury, revenue, splits) on any asset.
- Any milestone/reward tiers that aren't locked must read as "proposed", not promises. Any token/airdrop tease must carry a "planned / not guaranteed" hedge.
- Instagram = normie audience: sell the story/culture, no crypto jargon in the visible copy.

## Assets to produce
${rows.join("\n\n")}

## Output
Produce all pages in a single design file. Base each asset's text on its "Copy" block above (tighten for the format — don't dump full paragraphs onto a card). Keep every asset in the same house style so the set reads as one campaign.`;
}
