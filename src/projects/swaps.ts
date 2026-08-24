import type { ProjectConfig } from "./types";

// swaps.pro — the swap/bridge product in the KeepKey family, and one
// of SOPA's live revenue streams: the EVM swap split pays SOPA 20%, and the
// THORChain multi-affiliate memo `keep/thor1ujdj…:24/6` pays the KeepKey
// THORName 24 bps + SOPA 6 bps (= 20% of the 0.30% fee). Both are already
// tracked on the SOPA revenue orbit as project "swaps.pro"
// (src/lib/sopa-revenue-orbit.ts) — this portal is the ops side of the same
// brand. The brand is written "swaps.pro", lowercase, never "SwapPro".
//
// Deliberately minimal to start: no agent gateway, no Hive/Farcaster posting,
// no logo from the brand yet. Only the always-on modules (suggestions,
// campaigns, userbase, analytics, treasury, team, settings) are live; turn the
// feature flags on as the brand actually needs them.
const swaps: ProjectConfig = {
  slug: "swaps",
  name: "swaps.pro",
  description: "Internal ops portal for swaps.pro — the swap/bridge product.",
  // Same crew as KeepKey, its sibling in the switcher. Trim or extend as the
  // swaps.pro team takes shape.
  allowlist: ["xvlad", "bielcx", "keepkey", "illithics", "humbertoperes", "r4topunk", "nogenta", "louzoshi", "highlander22", "vaipraonde"],
  theme: {
    // Cyan — the one accent no other portal uses (lime SH, red Gnars, amber
    // SOPA, gold KeepKey, violet Vlad, monochrome Nogenta).
    accentLight: "#0e7490",
    accentDark: "#22d3ee",
    accentBgLight: "rgba(14, 116, 144, 0.1)",
    accentBgDark: "rgba(34, 211, 238, 0.12)",
    accentBorderLight: "rgba(14, 116, 144, 0.3)",
    accentBorderDark: "rgba(34, 211, 238, 0.35)",
    // Placeholder mark — swap for the real swaps.pro asset when it lands.
    logo: "/projects/swaps/logo.svg",
  },
  // No Hive presence yet.
  hive: {
    account: "",
    community: "",
  },
  farcaster: {
    channel: "",
  },
  repos: [],
  socials: [],
  // Sits right under KeepKey, below the divider that separates that org from
  // the Reelflip family.
  switcher: { rank: 110, parent: "keepkey" },
  // No agent online — the block reserves the SWAPS_* gateway prefix so the
  // chat/briefings light up the day SWAPS_GATEWAY_URL / _TOKEN are set.
  briefingAgents: [],
  agent: {
    gatewayEnvPrefix: "SWAPS",
    id: "swaps",
    displayName: "swaps.pro",
    emoji: "🔁",
    greeting: "Hey! I'm the swaps.pro agent. How can I help you today?",
  },
};

export default swaps;
