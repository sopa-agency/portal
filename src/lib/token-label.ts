// ---------------------------------------------------------------------------
// Token names and symbols that come from an INDEXER are attacker-controlled
// text. Anyone can deploy an ERC-20 and airdrop it into a wallet we display —
// the name is whatever they typed. A real one sitting in the SkateHive Base
// multisig right now:
//
//   symbol: "View Airdrops at https://airdapp.net"
//   name:   "! Airdapp.net"
//
// Rendered inside a portal wearing a client's brand, that reads as something
// SOPA endorsed. So this module exists to make one rule enforceable in one
// place: a token label is TEXT, never a link, never markup, never unbounded.
//
// What we do NOT do here: sanitize for HTML. React escapes children already,
// and adding a second, hand-rolled escaper would invite someone to reach for
// dangerouslySetInnerHTML thinking it is safe. The rule is simpler: labels only
// ever go into JSX as children or into a `title`/`alt` attribute — both escaped
// by React — and never into an href.
// ---------------------------------------------------------------------------

/** Max rendered length. Long enough for a real ticker or name, short enough
 *  that a sentence-as-a-name cannot take over the row. */
export const SYMBOL_MAX = 14;
export const NAME_MAX = 40;

// Control (Cc), format (Cf — zero-width joiners, bidi overrides like U+202E),
// surrogates (Cs), private use (Co) and unassigned (Cn). Bidi overrides are the
// nasty ones: they can visually reverse text so "moc.live" renders as "evil.com".
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;

/**
 * Make an indexer-supplied label safe to render as plain text.
 *
 * Strips invisible/bidi characters, collapses whitespace, trims, and truncates.
 * Returns "" when nothing legible survives — callers decide the placeholder, so
 * a blank name never silently becomes a plausible-looking ticker.
 */
export function sanitizeTokenLabel(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  // U+2026 rather than "..." so the ellipsis cannot be mistaken for part of the
  // name, and so the length stays predictable.
  return cleaned.slice(0, maxLen - 1).trimEnd() + "…";
}

// A label advertising a destination. We never linkify anything, so this is not
// a defence against auto-linking — it flags the row so the UI can say "not
// verified" instead of presenting attacker copy as neutral portfolio data.
const URLISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|app|finance|fi|link|click|site|online|top|live|vip)\b)/i;
// Words that only ever appear in bait, never in a real ticker.
const BAITY = /\b(airdrop|claim|reward|bonus|voucher|redeem|visit|winner|free)\b/i;

// Symbols we read over RPC from known contracts. An ENUMERATED token wearing
// one of these is impersonating a real holding — the most dangerous case,
// because it is the one that looks completely normal in a list.
const TRUSTED_SYMBOLS = new Set(["ETH", "WETH", "USDC", "USDBC", "USDT", "DAI", "HIVE", "HBD"]);

/**
 * True when a token label reads like an advert rather than an asset name, OR
 * when an untrusted token wears a trusted ticker.
 *
 * Used purely to LABEL the row — never to hide it silently and never to decide
 * value. Only call this for indexer-supplied labels: a config-declared USDC is
 * the real one.
 */
export function labelLooksHostile(...labels: string[]): boolean {
  if (labels.some((l) => URLISH.test(l) || BAITY.test(l))) return true;
  const symbol = (labels[0] ?? "").trim().toUpperCase();
  return TRUSTED_SYMBOLS.has(symbol);
}
