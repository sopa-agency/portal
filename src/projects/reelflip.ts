import type { ProjectConfig } from "./types";

// Reelflip — Instagram-first editorial brand (live IG metrics + posts to Hive
// via the SkateHive community as @reelflip). Accent: electric cyan/teal so it's
// visually distinct from SkateHive (lime) and Gnars (red) at a glance.
const reelflip: ProjectConfig = {
  slug: "reelflip",
  // Portal lives at admin.reelflip.com (the apex/www is for the public site).
  subdomain: "admin",
  switcher: { rank: 10 },
  lab: true,
  zineStudio: true,
  name: "Reelflip",
  description: "Internal ops portal for Reelflip — editorial brand applying the skater's lens to culture.",
  allowlist: [
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
    // Electric cyan — distinct from lime (skatehive) and red (gnars).
    accentLight: "#0891b2", // cyan-600
    accentDark: "#22d3ee",  // cyan-400
    accentBgLight: "rgba(8, 145, 178, 0.1)",
    accentBgDark: "rgba(34, 211, 238, 0.1)",
    accentBorderLight: "rgba(8, 145, 178, 0.3)",
    accentBorderDark: "rgba(34, 211, 238, 0.3)",
    logo: "/projects/reelflip/reelflip-avatar.png",
    favicon: "/projects/reelflip/favicon.ico",
  },
  hive: {
    // Reelflip posts to Hive THROUGH SkateHive — its own @reelflip account
    // (REELFLIP_HIVE_POSTING_KEY) posting into the SkateHive community, shown
    // on skatehive.app. No dedicated Reelflip Hive community.
    account: "reelflip",
    community: "hive-173115",
    frontend: "https://skatehive.app",
  },
  farcaster: {
    // Reelflip is Instagram-only for now; no Farcaster channel in use.
    channel: "reelflip",
  },
  repos: [
    // Reelflip has no repo-to-social repos (route is hidden).
  ],
  socials: [
    {
      platform: "Instagram",
      handle: "@reelflip",
      url: "https://instagram.com/reelflip",
      note: "Main and only operation for now — live metrics below",
      summary:
        "Editorial brand that applies the skater's way of seeing to culture at large — speaks *from* skate, not *about* it. Instagram is the entire operation: all weekly formats live here.",
      cadence: "Weekly per format (Post Opinion + Quocrete + Moodboard). Originals are events, not routine.",
      voice:
        "The older friend in the scene who overthinks it. Ironic, specific, never generic. Collective 'a gente'. Real scene slang only when it fits. Never 'paixão/superação/resiliência'.",
      formats: [
        {
          name: "Post Opinion (PERSPECTIVA) — P1",
          description:
            "Carousel/comic. Cliché on the cover → comic-balloon narrative → flip in the red box → community CTA. Takes a cliché or stigma and applies the skater lens. KPI: shares + follows.",
        },
        {
          name: "Quocrete — P1",
          description:
            "Single post: one sentence, one thesis, no explanation, set in concrete. A declaration that divides. KPI: saves + shares.",
        },
        {
          name: "Moodboard — P3",
          description:
            "AI-generated or curated image set, no explanatory caption. Confirms the world rather than arguing it. KPI: comments + qualified shares.",
        },
        {
          name: "Originals — P2",
          description:
            "Films & campaigns as editorial events; the product drop materializes the perspective. First event: skate+fashion film (~1 month out). KPI: clicks, drop traffic, sales.",
        },
      ],
      dos: [
        "Lead with P1 to prove the lens and grow reach via shares",
        "Keep it 'fewer, sharper': one POV, two hero messages, three formats",
        "Hero line: 'Não é sobre andar de skate. É sobre enxergar como quem anda.'",
      ],
      donts: [
        "Don't post anything a generic skate shop could sign",
        "Don't explain the POV — trust the persona to get it",
        "Don't multiply series/themes — deepen what works",
      ],
    },
    {
      platform: "Facebook",
      handle: "Reelflip",
      url: "https://www.facebook.com/1155915860935202",
      note: "Page paired with the IG business account — read-only for now",
      summary:
        "Exists to anchor the Instagram business account in Meta's graph. A metrics surface; Reelflip's voice lives on Instagram.",
      cadence: "No active cadence.",
      voice: "n/a — mirror of Instagram if ever used.",
    },
  ],
  postCreator: true,
  // GA4 property for reelflip.com (the public homepage — the gtag loads only
  // there). Read via the SkateHive service account (Viewer on the property).
  analytics: {
    ga4PropertyId: "541423360",
    gscSiteUrl: "sc-domain:reelflip.com",
  },
  // Reelflip operates all the portals — its treasury page shows its own Safe
  // plus the Gnars and SkateHive treasuries, with per-project views.
  treasury: {
    ethWallets: [
      { label: "Reelflip Safe", address: "0xF82e7290d6538fE365a0ed4E4AFB9ae9E1656485" },
    ],
    hiveAccounts: [{ label: "Reelflip Hive Account", account: "reelflip" }],
    includeProjects: ["gnars", "skatehive"],
  },
  // Reelflip is an Instagram-first editorial brand — NOT a Hive platform — so
  // override the default campaign-artifact framing with its real persona/voice.
  campaignArtifacts: {
    persona:
      "the editorial lead at Reelflip — a brand that applies the skater's way of seeing to culture at large (it speaks *from* skate, not *about* it). Reelflip is Instagram-first and also cross-posts to Hive via the SkateHive community",
    voiceHint:
      "The older friend in the scene who overthinks it. Ironic, specific, never generic. Collective 'a gente'. Real scene slang only when it fits — never 'paixão/superação/resiliência'. Don't write anything a generic skate shop could sign. Hero line to live up to: 'Não é sobre andar de skate. É sobre enxergar como quem anda.'",
  },
  weeklyRecap: {
    sourcesHint:
      "use your playbook (docs/playbook.md) and your Instagram knowledge; the portal also tracks live IG metrics (reach, saves, shares per format)",
    sections: [
      "What shipped this week across the formats (Post Opinion, Quocrete, Moodboard) + any Originals progress",
      "Performance read — reach (especially non-follower), saves and shares per format; what's resonating vs flat",
      "Audience signals — comments / DMs or cultural moments worth noting",
      "Next week — the one P1 piece to ship, plus any Originals milestone",
    ],
  },
  briefingAgents: [
    { slug: "reelflip", label: "Reelflip", tabLabel: "BRIEF", workspace: "workspace-reelflip" },
  ],
  agent: {
    gatewayEnvPrefix: "REELFLIP",
    id: "reelflip",
    displayName: "Reelflip",
    emoji: "🎬",
    greeting: "Hey! I'm the Reelflip agent. How can I help you today?",
  },
  prompts: {
    dir: "prompts/reelflip",
  },
  teamEmails: [
    "ernatogalvao@gmail.com",
    "r4topunk.eth@gmail.com",
    "sktbrd.eth@gmail.com",
    "totaltotalblack@gmail.com",
  ],
  githubProject: {
    org: "ReelflipOrg",
    number: 1,
  },
};

export default reelflip;
