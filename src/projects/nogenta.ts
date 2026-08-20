import type { ProjectConfig } from "./types";

// Nogenta — skate editorial brand under the Reelflip family. Black & white
// identity (the only monochrome portal). Publishes to Hive THROUGH SkateHive
// (its own @nogenta account into the SkateHive community, shown on
// skatehive.app), plus Instagram and Farcaster.
//
// No agent yet: the `agent` block below satisfies the config type and reserves
// the NOGENTA_* gateway prefix, but the chat/briefings stay dark until those
// envs (NOGENTA_GATEWAY_URL / _TOKEN, NOGENTA_INSTAGRAM_*, etc.) are wired and
// an openclaw workspace-nogenta agent is registered. briefingAgents is empty
// until then, same pattern SOPA uses.
const nogenta: ProjectConfig = {
  slug: "nogenta",
  switcher: { rank: 30, parent: "skatehive" },
  zineStudio: true,
  name: "Nogenta",
  description: "Internal ops portal for Nogenta — skate editorial brand under the Reelflip family.",
  allowlist: [
    "bielcx",
    "xvlad",
    "nogenta",
    "vaipraonde",
    "mengao",
    "louzoshi",
    "willdias",
    "reelflip",
    "joaoparmagnani",
    "keepkey",
    "illithics",
    "humbertoperes",
    "r4topunk",
    "highlander22",
  ],
  theme: {
    // Monochrome: near-black accent in light mode, near-white in dark. The only
    // black & white portal — distinct from lime (SH), red (Gnars), cyan
    // (Reelflip), amber (SOPA), gold (KeepKey).
    accentLight: "#0a0a0a",
    accentDark: "#fafafa",
    accentBgLight: "rgba(0, 0, 0, 0.06)",
    accentBgDark: "rgba(255, 255, 255, 0.1)",
    accentBorderLight: "rgba(0, 0, 0, 0.25)",
    accentBorderDark: "rgba(255, 255, 255, 0.3)",
    logo: "/projects/nogenta/logo.svg",
  },
  hive: {
    // Posts to Hive THROUGH SkateHive — @nogenta into the SkateHive community,
    // shown on skatehive.app (mirrors Reelflip's setup).
    account: "nogenta",
    community: "hive-173115",
    frontend: "https://skatehive.app",
  },
  farcaster: {
    channel: "nogenta",
  },
  repos: [],
  socials: [
    {
      platform: "Instagram",
      handle: "@nogenta",
      url: "https://instagram.com/nogenta",
      note: "Confirm the real handle — placeholder until verified",
      summary:
        "Nogenta's primary channel — skate editorial. Strategy and formats to be defined as the brand comes online.",
    },
    {
      platform: "Hive",
      handle: "@nogenta",
      url: "https://skatehive.app/@nogenta",
      summary: "Cross-posts to Hive via the SkateHive community, shown on skatehive.app.",
    },
  ],
  // Instagram-first like Reelflip — enable the Post Creator. Publishing needs
  // the NOGENTA_INSTAGRAM_* envs before it works end-to-end.
  postCreator: true,
  // TikTok review queue. Needs NOGENTA_TIKTOK_CLIENT_KEY/_SECRET plus an OAuth
  // connect from the page; until TikTok audits the app every publish is forced
  // to private (see docs/tiktok-setup.md).
  tiktok: true,
  campaignArtifacts: {
    persona:
      "the editorial lead at Nogenta — a skate brand under the Reelflip family. Instagram-first, also cross-posting to Hive via the SkateHive community",
    voiceHint:
      "Skater's voice, specific and real — never generic. Avoid clichés like 'paixão/superação/resiliência'. Don't write anything a generic skate shop could sign.",
  },
  // No agent online yet — keep briefings empty until the gateway/workspace land.
  briefingAgents: [],
  agent: {
    gatewayEnvPrefix: "NOGENTA",
    id: "nogenta",
    displayName: "Nogenta",
    emoji: "🛹",
    greeting: "E aí! Sou o agente da Nogenta. Como posso ajudar?",
  },
};

export default nogenta;
