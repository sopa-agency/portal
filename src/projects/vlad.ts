import type { ProjectConfig } from "./types";

// Vlad — personal influencer brand, operated under the Reelflip umbrella (the
// first of the influencer accounts Reelflip manages). Instagram/TikTok/YouTube-
// first; cross-posts to Hive via the SkateHive community as @xvlad. Accent:
// violet, distinct from lime (SkateHive), red (Gnars) and cyan (Reelflip).
//
// Instagram is wired: @skate.mkv (business account id in VLAD_INSTAGRAM_*,
// via the "Vlad" FB Page under the SkateHive Business Manager system user).
// Hive posting wired as @xvlad (VLAD_HIVE_POSTING_KEY, from OpenClaw).
// Socials: IG @skate.mkv, X @sk8ordao, Farcaster @skateboard, Hive @xvlad.
// Agent: OpenClaw "secretario" (chat + briefing) over the shared gateway.
// TODO(vlad): drop the logo at public/projects/vlad/logo.png.
const vlad: ProjectConfig = {
  slug: "vlad",
  // Portal lives at vlad.reelflip.com (needs the subdomain pointed in Vercel/DNS).
  switcher: { rank: 40, parent: "reelflip" },
  name: "Vlad",
  description: "Internal ops portal for Vlad — personal influencer brand under Reelflip.",
  // Restricted to @xvlad for now (personal influencer portal). SOPA global
  // admins still have access via their global role. Add more Hive usernames
  // here to grant others.
  allowlist: ["xvlad"],
  theme: {
    // Violet — distinct from lime (skatehive), red (gnars), cyan (reelflip).
    accentLight: "#7c3aed", // violet-600
    accentDark: "#a78bfa", // violet-400
    accentBgLight: "rgba(124, 58, 237, 0.1)",
    accentBgDark: "rgba(167, 139, 250, 0.12)",
    accentBorderLight: "rgba(124, 58, 237, 0.3)",
    accentBorderDark: "rgba(167, 139, 250, 0.35)",
    logo: "/projects/vlad/logo.png",
  },
  hive: {
    // Posts to Hive through the SkateHive community as @xvlad (like Reelflip).
    account: "xvlad",
    community: "hive-173115",
    frontend: "https://skatehive.app",
  },
  farcaster: {
    channel: "vlad", // TODO(vlad): confirm channel (or drop if unused).
  },
  repos: [],
  socials: [
    {
      platform: "Instagram",
      handle: "@skate.mkv",
      url: "https://instagram.com/skate.mkv",
      note: "Primary channel — live metrics below (VLAD_INSTAGRAM_* wired).",
      summary: "Personal influencer feed — the main operation. Reels + carousels.",
    },
    {
      platform: "Facebook",
      handle: "Vlad",
      note: "Page paired with the IG business account (the API bridge). Read-only for now.",
      summary: "Exists to anchor the skate.mkv Instagram business account in Meta's graph; metrics ride the same token.",
    },
    {
      platform: "X",
      handle: "@sk8ordao",
      url: "https://x.com/sk8ordao",
      summary: "Text + repost reach. Publish via the X composer intent.",
    },
    {
      platform: "Farcaster",
      handle: "@skateboard",
      url: "https://warpcast.com/skateboard",
      summary: "Onchain-native audience. Casts via managed signer when wired.",
    },
    {
      platform: "Hive",
      handle: "@xvlad",
      url: "https://skatehive.app/@xvlad",
      note: "Cross-posts as snaps to the SkateHive community.",
      summary: "Mirrors highlights to Hive as @xvlad via the SkateHive community.",
    },
  ],
  postCreator: true,
  meetings: true,
  lab: true,
  // Personal Kanban — GitHub Project V2 (PRIVATE) owned by the sktbrd USER
  // account (not an org). fetchGitHubProject resolves owner as user OR org, so
  // `org` holds the user login here. Needs a token with project+repo access to
  // sktbrd's projects: the global GITHUB_TOKEN (sktbrd's PAT) should cover it;
  // else set VLAD_GITHUB_TOKEN. Replaces the Trello board the Secretário used.
  githubProject: {
    org: "sktbrd",
    number: 9,
  },
  // Personal-brand framing for campaign-artifact generation (not a Hive platform).
  campaignArtifacts: {
    persona: "Vlad's content lead — a personal influencer brand under Reelflip, Instagram-first (@skate.mkv), with cross-posts to X, Farcaster and Hive (via the SkateHive community)",
    voiceHint: "First-person, personal and direct; the creator's own voice — not corporate. Portuguese by default.",
  },
  // The OpenClaw "secretario" agent runs Vlad's chat + home briefing. It's a
  // registered agent (workspace-secretario) reached over the SHARED gateway
  // (global GATEWAY_TOKEN / OPENCLAW_GATEWAY_URL, routed by agent id) — so no
  // VLAD_GATEWAY_TOKEN is needed.
  briefingAgents: [
    { slug: "secretario", label: "Secretário", tabLabel: "SEC", workspace: "workspace-secretario" },
  ],
  agent: {
    gatewayEnvPrefix: "VLAD",
    id: "secretario",
    displayName: "Secretário",
    emoji: "🤵",
    greeting: "Olá! Sou o Secretário do Vlad. Como posso ajudar?",
  },
};

export default vlad;
