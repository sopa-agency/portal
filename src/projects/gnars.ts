import type { ProjectConfig } from "./types";

// Gnars DAO — extreme sports collective on Base/Hive, born from Nouns DAO.
// Accent: Gnars red noggles — #d11d2a (light) / #ff3344 (dark).
const gnars: ProjectConfig = {
  slug: "gnars",
  switcher: { rank: 20, parent: "skatehive" },
  lab: true,
  zineStudio: true,
  name: "Gnars",
  description: "Internal ops portal for Gnars DAO.",
  allowlist: [
    "bielcx",
    "xvlad",
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
    "nogenta",
  ],
  theme: {
    // Gnars red noggles — matches portal-gnars globals.css exactly.
    accentLight: "#d11d2a",
    accentDark: "#ff3344",
    accentBgLight: "rgba(209, 29, 42, 0.1)",
    accentBgDark: "rgba(255, 51, 68, 0.12)",
    accentBorderLight: "rgba(209, 29, 42, 0.3)",
    accentBorderDark: "rgba(255, 51, 68, 0.35)",
    logo: "/projects/gnars/logo.png",
  },
  hive: {
    // Gnars posts to the gnars Hive community.
    account: "gnars",
    community: "hive-173115", // shared skateboarding/extreme-sports community
    // skatehive.app is the official Hive frontend for the SkateHive-branch
    // portals (SkateHive, Gnars, Reelflip). Posts read/link via skatehive.app,
    // NOT peakd — peakd is only used by KeepKey (no frontend set there).
    frontend: "https://skatehive.app",
  },
  farcaster: {
    // Gnars casts in the /gnars channel on Farcaster.
    channel: "gnars",
  },
  repos: [
    "r4topunk/gnars-website",
  ],
  socials: [
    {
      platform: "Farcaster",
      handle: "@gnars",
      url: "https://warpcast.com/gnars",
      note: "casts in /gnars via Neynar managed signer",
      summary:
        "Primary channel — Gnars is a Nouns-born, onchain-native DAO and Farcaster is where that audience lives. Casts in the /gnars channel.",
      cadence: "Per update + DAO/builder milestones.",
      voice: "Noggles-up, irreverent, builder-energy. Onchain-native framing. Steve Crabalero's crew.",
      formats: [
        { name: "Cross-posted casts", description: "Product/DAO updates with rich-link embeds (gnars.com / proposals)." },
        { name: "DAO milestones", description: "Proposals, auctions, builder wins worth rallying the channel around." },
      ],
      dos: ["Lead with onchain/DAO relevance", "Keep under ~320 chars", "Rally builders & noggle-holders"],
      donts: ["Don't overload embeds (max 2)", "Don't flatten the irreverent voice into corporate copy"],
    },
    {
      platform: "Hive",
      handle: "@gnars",
      url: "https://gnars.com",
      note: "snaps via @gnars (shared extreme-sports community)",
      summary: "Mirrors updates to Hive as snaps, reaching the shared skate/extreme-sports community.",
      cadence: "Mirrors Farcaster cross-posts.",
      voice: "Same Gnars voice; skate/extreme-sports flavored.",
      formats: [{ name: "Cross-posted snaps", description: "Same draft as Farcaster, posted as a Hive snap." }],
      dos: ["Credit builders/riders", "Link gnars.com"],
      donts: ["No hashtags"],
    },
    {
      platform: "X",
      handle: "@gnars",
      url: "https://x.com/gnars",
      note: "manual publish via intent (no API auto-post)",
      summary: "Broader reach. Same drafts, published by opening the X composer pre-filled.",
      cadence: "Opportunistic, from the same draft batch.",
      voice: "Punchy, noggles-up; ≤280 chars including any link.",
      formats: [{ name: "Intent posts", description: "Text (+ manual image) opened in the X composer from the cross-post trigger." }],
      dos: ["Keep ≤280 chars"],
      donts: ["No hashtags"],
    },
    {
      platform: "Instagram",
      handle: "@gnarsdao",
      url: "https://instagram.com/gnarsdao",
      note: "Live metrics below",
      summary:
        "Visual channel for the Gnars DAO — athletes, drops, events, and onchain-native culture in image/Reel form.",
      cadence: "Per drop/event + athlete moments.",
      voice: "Noggles-up, irreverent, builder-energy; visual-first.",
      formats: [
        { name: "Athlete & event", description: "Riders, sessions, physical product, events." },
        { name: "Reels", description: "Short clips of drops, builds, and culture moments." },
      ],
      dos: ["Lead with the visual", "Tie back to onchain/DAO when it fits"],
      donts: ["Don't flatten the irreverent voice into corporate copy", "No hashtag spam"],
    },
    {
      platform: "Facebook",
      handle: "Gnars",
      url: "https://www.facebook.com/1162499943612277",
      note: "New page — read-only for now (metrics via the same Meta token)",
      summary:
        "Freshly created page paired with the IG business account. A metrics surface for now; content mirroring can come later.",
      cadence: "No active cadence yet.",
      voice: "Same as Instagram when mirrored.",
    },
  ],
  // Gnars doesn't use the userbase (email) module.
  postCreator: true,
  meetings: true,
  // Mirrors gnars.com/treasury — the DAO treasury on Base.
  treasury: {
    ethWallets: [
      { label: "Gnars DAO Treasury", address: "0x72ad986ebac0246d2b3c565ab2a1ce3a14ce6f88" },
    ],
    hiveAccounts: [{ label: "Gnars Hive Account", account: "gnars" }],
  },
  // GA4 + Search Console for gnars.com (service account: bobgnarley@gnars-489819,
  // creds in GNARS_GOOGLE_SERVICE_ACCOUNT_JSON).
  //
  // GSC uses the DOMAIN property (sc-domain:gnars.com) — captures www + non-www
  // + both protocols, and survives host changes (the site moved to the www
  // canonical in ~May 2026). Verification is a DNS TXT on the gnars.com zone
  // (Cloudflare). The service account must be added as a user on the property.
  analytics: {
    ga4PropertyId: "527420949",
    gscSiteUrl: "sc-domain:gnars.com",
    brandedTerms: ["gnars"],
  },
  // Steve assembles the weekly recap from live governance, not Hive clips.
  weeklyRecap: {
    sourcesHint:
      "run scripts/gnars-subgraph.sh (active-proposals / proposals / votes / feed) for governance + auctions, check your governance memory and docs, and treat gnars.com /proposals + /treasury as stronger truth than memory",
    sections: [
      "Governance — proposals that moved this week (passed / failed / live), votes vs the 600 quorum, what each funds, and any follow-up or accountability gap",
      "Treasury & auctions — recent auction settlements/bids and any material treasury event",
      "Builds & products — what shipped or changed on gnars.com, gnars.center, gnars.tv; builder progress",
      "Culture — Gnarly News drops, events (Luma), athlete or physical-product moments",
      "The flywheel read — 1-2 lines on how this week advanced physical ↔ digital ↔ culture ↔ funding",
      "Next week watch — live proposals + deadlines, upcoming auctions/events",
    ],
  },
  briefingAgents: [
    {
      slug: "gnars-steve",
      label: "Steve Crabalero",
      tabLabel: "STEVE",
      workspace: "workspace-gnars-steve",
    },
  ],
  agent: {
    gatewayEnvPrefix: "GNARS",
    id: "gnars-steve",
    displayName: "Steve Crabalero",
    emoji: "🦀",
    greeting: "Yo! Steve Crabalero here. Gnars DAO, noggles up, shred forever. What do you need, fam?",
  },
  prompts: {
    dir: "prompts/gnars",
  },
  teamEmails: [
    "ernatogalvao@gmail.com",
    "gami@bitlabs.dev",
    "humbertopereskt@gmail.com",
    "joaopedroparmagnani@gmail.com",
    "louzoshi.eth@gmail.com",
    "nogentaskate@gmail.com",
    "r4topunk.eth@gmail.com",
    "sktbrd.eth@gmail.com",
    "totaltotalblack@gmail.com",
  ],
  githubProject: {
    org: "gnars-dao",
    number: 4,
  },
};

export default gnars;
