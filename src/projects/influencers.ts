import type { ProjectConfig } from "./types";

// Influencers — the division, not a person. This portal is the DIVISION'S HOME:
// the place the crew runs the roster from, and the parent every individual
// influencer portal hangs under in the switcher.
//
// The shape was a deliberate choice: an influencer gets their OWN portal (own
// subdomain, own theme, own allowlist, own accounts), exactly like Vlad already
// had — not a row in a shared list. That keeps each person's accounts and agent
// isolated from the others, which is the same reason brands are isolated.
//
// Adding the next influencer is ONE file:
//   1. src/projects/<name>.ts — copy vlad.ts, set slug/name/theme/allowlist and
//      their Hive/Instagram/Farcaster accounts
//   2. register it in ./index.ts
//   3. switcher: { rank: 5x, parent: "influencers" }
//   4. point <name>.sopa.team at the project on Vercel
const influencers: ProjectConfig = {
  slug: "influencers",
  name: "Influencers",
  description: "Division home for the influencer roster SOPA operates — each influencer has their own portal below.",
  // The SOPA crew runs the division; each individual portal keeps its own,
  // narrower allowlist (Vlad's is just @xvlad).
  allowlist: [
    "bielcx",
    "xvlad",
    "vaipraonde",
    "mengao",
    "louzoshi",
    "willdias",
    "joaoparmagnani",
    "r4topunk",
    "nogenta",
    "highlander22",
  ],
  theme: {
    // Magenta — the last free accent (lime SkateHive, red Gnars, amber SOPA,
    // gold KeepKey, violet Vlad, cyan swaps.pro, monochrome Nogenta).
    accentLight: "#be185d",
    accentDark: "#f472b6",
    accentBgLight: "rgba(190, 24, 93, 0.1)",
    accentBgDark: "rgba(244, 114, 182, 0.12)",
    accentBorderLight: "rgba(190, 24, 93, 0.3)",
    accentBorderDark: "rgba(244, 114, 182, 0.35)",
    logo: "/projects/influencers/logo.svg",
  },
  // The division itself publishes nothing — the people do.
  hive: { account: "", community: "" },
  farcaster: { channel: "" },
  repos: [],
  socials: [],
  // Sits above the individual influencer portals, which indent under it.
  // Desceu de 40 para 120: a divisão vai para o fim da lista inteira. O Vlad
  // pendura nela (parent: "influencers") e desceu junto, para 130 — mover só o
  // pai deixaria o filho renderizando ACIMA dele, com o recuo apontando para
  // nada. Bloco desce inteiro ou não desce.
  // `dividerBefore` porque a divisão desceu para DEPOIS do bloco da KeepKey, e
  // sem a régua ela pareceria mais uma marca de fora — que é justamente o que
  // ela não é. A régua devolve o agrupamento que a descida tirou.
  switcher: { rank: 120, dividerBefore: true },
  briefingAgents: [],
  agent: {
    gatewayEnvPrefix: "INFLUENCERS",
    id: "influencers",
    displayName: "Influencers",
    emoji: "🎬",
    greeting: "E aí! Sou o agente da divisão de influencers da SOPA. Como posso ajudar?",
  },
};

export default influencers;
