import type { ProjectConfig } from "./types";

// SOPA — the umbrella org above everything. Treasury-only portal: a single
// combined view of every treasury the org operates (Reelflip Safe + Gnars +
// SkateHive). All other modules are hidden; "/" redirects to /treasury.
const sopa: ProjectConfig = {
  slug: "sopa",
  name: "SOPA",
  description: "SOPA umbrella — every portal treasury in one place.",
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
    // Warm amber — the umbrella sits visually apart from every brand below it.
    accentLight: "#b45309", // amber-700
    accentDark: "#fbbf24",  // amber-400
    accentBgLight: "rgba(180, 83, 9, 0.1)",
    accentBgDark: "rgba(251, 191, 36, 0.12)",
    accentBorderLight: "rgba(180, 83, 9, 0.3)",
    accentBorderDark: "rgba(251, 191, 36, 0.35)",
    logo: "/projects/sopa/logo.svg",
  },
  // Placeholders — every publishing route is hidden on this portal.
  hive: {
    account: "sopa",
    community: "hive-173115",
  },
  farcaster: {
    channel: "sopa",
  },
  repos: [],
  socials: [],
  // Treasury-only: hide every other module from the sidebar; "/" redirects
  // to /treasury (see src/app/page.tsx).
  hiddenRoutes: [
    "/",
    "/marketing-suggestions",
    "/campaign-creator",
    "/userbase",
    "/brain",
    "/analytics",
    "/team",
  ],
  // No wallets of its own — the page shows the combined view of everything
  // the org operates (empty own group is filtered out).
  // Deck-style presentation of the SOPA model (the agency, the engagement
  // tiers, the operating structure). Enables the /about route + nav item.
  about: true,
  // Editable org-chart flowchart + portfolio (SOPA-only tools).
  orgChart: true,
  portfolio: true,
  treasury: {
    // SOPA's own multisig (Safe on Base).
    ethWallets: [{ label: "SOPA Safe", address: "0x96C37393B79aD7EABdF9Ccf82C2EDAd3d3c0eEA2" }],
    includeProjects: ["reelflip", "gnars", "skatehive"],
  },
  switcher: { rank: 0 },
  briefingAgents: [],
  agent: {
    gatewayEnvPrefix: "SOPA",
    id: "sopa",
    displayName: "SOPA",
    emoji: "🍲",
    greeting: "Oi! Sou o agente da SOPA. Posso ajudar com a visão geral dos tesouros.",
  },
};

export default sopa;
