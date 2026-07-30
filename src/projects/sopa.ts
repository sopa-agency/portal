import type { ProjectConfig } from "./types";

// SOPA — the umbrella org above everything. Treasury-only portal: a single
// combined view of every treasury the org operates (Reelflip Safe + Gnars +
// SkateHive). All other modules are hidden; "/" redirects to /treasury.
const sopa: ProjectConfig = {
  slug: "sopa",
  name: "SOPA",
  description: "SOPA umbrella — every portal treasury in one place.",
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
    // Warm amber — the umbrella sits visually apart from every brand below it.
    accentLight: "#b45309", // amber-700
    accentDark: "#fbbf24",  // amber-400
    accentBgLight: "rgba(180, 83, 9, 0.1)",
    accentBgDark: "rgba(251, 191, 36, 0.12)",
    accentBorderLight: "rgba(180, 83, 9, 0.3)",
    accentBorderDark: "rgba(251, 191, 36, 0.35)",
    logo: "/projects/sopa/logo.png",
    favicon: "/projects/sopa/logo.svg", // crisp SVG mark for the browser tab
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
  // "/" is the SOPA home: an aggregated morning briefing with every project's
  // next actions (see src/app/page.tsx + components/sopa-briefing.tsx).
  hiddenRoutes: [
    "/marketing-suggestions",
    "/campaign-creator",
    "/userbase",
    "/brain",
    "/analytics",
  ],
  // No wallets of its own — the page shows the combined view of everything
  // the org operates (empty own group is filtered out).
  // Deck-style presentation of the SOPA model (the agency, the engagement
  // tiers, the operating structure). Enables the /about route + nav item.
  about: true,
  // Editable org-chart flowchart + portfolio + weekly meetings (SOPA-only tools).
  orgChart: true,
  portfolio: true,
  // Triage queue for briefs sent through the public site's contact form.
  briefs: true,
  meetings: true,
  // SOPA is the hub: its Kanban aggregates every registered portal's board
  // (read-only). Reelflip's board drops out automatically now that the project
  // is unregistered — no need to disable the whole aggregate.
  kanbanAggregate: true,
  treasury: {
    ethWallets: [
      // SOPA's own multisig (Safe on Base).
      { label: "SOPA Safe", address: "0x96C37393B79aD7EABdF9Ccf82C2EDAd3d3c0eEA2" },
      // Reelflip is retired as a portal, but keep its Safe here so the funds can
      // be transferred out later.
      { label: "Reelflip Safe", address: "0xF82e7290d6538fE365a0ed4E4AFB9ae9E1656485" },
    ],
    hiveAccounts: [{ label: "Reelflip Hive Account", account: "reelflip" }],
    includeProjects: ["gnars", "skatehive"],
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
