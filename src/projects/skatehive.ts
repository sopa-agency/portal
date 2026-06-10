import type { ProjectConfig } from "./types";

const skatehive: ProjectConfig = {
  slug: "skatehive",
  name: "SkateHive",
  description: "Internal marketing ops portal for SkateHive.",
  allowlist: [
    "xvlad",
    "howdarylrolls",
    "skatehive",
    "skatedev",
    "skatehacker",
    "mengao",
    "louzoshi",
    "knowhow92",
    "web-gnar",
    "vaipraonde",
    "nogenta",
    "humbertoperes",
    "willdias",
    "reelflip",
    "joaoparmagnani",
  ],
  teamContacts: {
    xvlad: [
      { label: "Telegram", value: "@gnarlyvlad", url: "https://t.me/gnarlyvlad" },
      { label: "Farcaster", value: "@skateboard", url: "https://warpcast.com/skateboard" },
      { label: "Email", value: "sktbrd.eth@gmail.com", url: "mailto:sktbrd.eth@gmail.com" },
    ],
    skatehive: [
      { label: "Instagram", value: "@skatehive", url: "https://instagram.com/skatehive" },
      { label: "X", value: "@Skate_Hive", url: "https://x.com/Skate_Hive" },
      { label: "Farcaster", value: "@skatehive", url: "https://warpcast.com/skatehive" },
      { label: "Discord", value: "SkateHive", url: "https://chat.skatehive.app" },
    ],
    skatedev: [
      { label: "GitHub", value: "SkateHive", url: "https://github.com/SkateHive" },
    ],
    mengao: [
      { label: "Farcaster", value: "@mengao", url: "https://warpcast.com/mengao" },
    ],
  },
  postCreator: true,
  theme: {
    // Lime green — darker for legibility on light bg, vivid on dark bg.
    accentLight: "#5b9c00",
    accentDark: "#a3e635",
    accentBgLight: "rgba(91, 156, 0, 0.1)",
    accentBgDark: "rgba(163, 230, 53, 0.1)",
    accentBorderLight: "rgba(91, 156, 0, 0.3)",
    accentBorderDark: "rgba(163, 230, 53, 0.3)",
    logo: "/projects/skatehive/logo.svg",
    favicon: "/projects/skatehive/favicon.ico",
  },
  hive: {
    account: "skatehive",
    community: "hive-173115",
    frontend: "https://skatehive.app",
    magBeneficiaries: [
      { account: "skatehive", weight: 500 }, // 5% — platform
      { account: "xvlad", weight: 500 }, // 5% — operator
    ],
  },
  farcaster: {
    channel: "skateboard",
  },
  repos: [
    "SkateHive/skatehive3.0",
  ],
  socials: [
    {
      platform: "Instagram",
      handle: "@skatehive",
      url: "https://instagram.com/skatehive",
      note: "IG Business account (via the SkateHive Meta app)",
      summary:
        "Mainstream reach beyond the crypto bubble. Skate clips, contest highlights, and big launches repackaged for a general skate audience.",
      cadence: "A few times a week — reels of community clips + milestone posts.",
      voice: "Casual, skater-first, visual. Let the footage carry it; minimal caption.",
      formats: [
        { name: "Reels", description: "Short skate clips from the community and contests — the main growth driver." },
        { name: "Launch posts", description: "Big product/app launches worth a feed post (carousel or single)." },
      ],
      dos: ["Lead with the clip/visual", "Credit the skater/filmer", "Use a clear CTA to the app on launches"],
      donts: ["Don't post dev/infra updates here", "Don't over-caption — let the footage talk"],
    },
    {
      platform: "Hive",
      handle: "@skatehive",
      url: "https://skatehive.app",
      note: "snaps in hive-173115, posted via @skatehive",
      summary:
        "Home turf and source of truth. Product updates and community wins go out as snaps in the SkateHive community; everything else cross-posts from here.",
      cadence: "Per shippable update + community highlights (driven by Repo-to-Social).",
      voice: "Casual, skater-friendly, no corporate speak. Credit builders and skaters by name.",
      formats: [
        { name: "Repo-to-Social snaps", description: "Commit-driven product update posts, one per user-visible change." },
        { name: "Community highlights", description: "Reposts/spotlights of skater clips and contests from the feed." },
      ],
      dos: ["Name which app the update ships to (webapp vs iOS)", "Link skatehive.app or a specific sub-page", "Lead with user-visible value"],
      donts: ["No hashtags", "Don't post refactors/CI/infra changes", "Don't repeat a feature already announced"],
    },
    {
      platform: "Farcaster",
      handle: "@skatehive",
      url: "https://warpcast.com/skatehive",
      note: "casts in /skateboard via Neynar managed signer",
      summary:
        "Crypto-native distribution. Mirrors the Hive snaps as casts in the /skateboard channel with rich-link embeds for Warpcast previews.",
      cadence: "Mirrors Hive cross-posts.",
      voice: "Same skater voice; lean into crypto-native, onchain-friendly framing where natural.",
      formats: [{ name: "Cross-posted casts", description: "Up to 2 URL embeds; skatehive.app links and images get embed priority." }],
      dos: ["Keep under ~320 chars", "Include a rich-preview link"],
      donts: ["Don't overload with embeds (max 2)"],
    },
    {
      platform: "X",
      handle: "@Skate_Hive",
      url: "https://x.com/Skate_Hive",
      note: "manual publish via intent (no API auto-post)",
      summary: "Reach beyond the bubble. Same drafts as Hive/Farcaster, published by opening the X composer pre-filled.",
      cadence: "Opportunistic, from the same draft batch.",
      voice: "Punchy, skater-friendly; ≤280 chars including any link.",
      formats: [{ name: "Intent posts", description: "Text (+ manually attached image) opened in the X composer from the cross-post trigger." }],
      dos: ["Keep ≤280 chars", "Attach the image manually when prompted"],
      donts: ["No hashtags"],
    },
  ],
  briefingAgents: [
    { slug: "skate-dev", label: "SkateHive Dev", tabLabel: "DEV", workspace: "workspace-skate-dev" },
    {
      slug: "skatehive-marketing",
      label: "SkateHive Marketing",
      tabLabel: "MKT",
      workspace: "workspace-skatehive-marketing",
    },
  ],
  agent: {
    gatewayEnvPrefix: "SKATEHIVE",
    id: "skatehive-marketing",
    displayName: "SkateHive Marketing",
    emoji: "📣",
    greeting: "Oi! Sou o agente de marketing da SkateHive. Como posso ajudar?",
  },
  prompts: {
    dir: "prompts/skatehive",
  },
  teamEmails: ["sktbrd.eth@gmail.com"],
  githubProject: {
    org: "SkateHive",
    number: 1,
  },
  analytics: {
    ga4PropertyId: "527345741",
    gscSiteUrl: "sc-domain:skatehive.app",
    // Singapore traffic is overwhelmingly bots — exclude from GA4 reports.
    excludeCountries: ["SG"],
    brandedTerms: ["skatehive", "skate hive"],
  },
};

export default skatehive;
