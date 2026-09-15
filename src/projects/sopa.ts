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
  hive: {
    account: "s0p4", // criada em 11/09/2026 (PR #87)
    // ATENÇÃO: hive-173115 é a comunidade da SKATEHIVE. A SOPA não tem
    // comunidade própria ainda; enquanto for assim, um snap publicado daqui
    // cairia na comunidade da SkateHive assinado por @s0p4. Publicar em Hive
    // também depende de SOPA_HIVE_POSTING_KEY, que não existe. Redigir e
    // agendar funciona; publicar em Hive não, e é proposital até isto mudar.
    community: "hive-173115",
  },
  farcaster: {
    // O canal /sopa NÃO existe no Farcaster (conferido em 15/09/2026) e o
    // signer da SOPA no banco está revogado (era o fid da Gnars). É um
    // placeholder que o tipo exige; o cast fica como rascunho para copiar.
    channel: "sopa",
  },
  // O repo do próprio portal. Estava de fora, e isso deixava invisível o
  // trabalho que a equipe mais faz: o relatório diário lê commits a partir
  // daqui, e sem esta linha um dia inteiro de commits no portal aparecia como
  // um dia sem nada.
  repos: ["sopa-agency/portal"],
  // As redes que a SOPA tem de fato (15/09/2026). O X é o que o site sopa.team
  // aponta; a Hive é a conta nova. Sem API do X, a métrica dele fica "n/d" e
  // o tweet é copiar e colar — o mesmo que vale para as outras marcas.
  socials: [
    { platform: "X", handle: "@sopaagency", url: "https://x.com/sopaagency", note: "conta da agência; o site sopa.team aponta para cá" },
    { platform: "Hive", handle: "@s0p4", url: "https://peakd.com/@s0p4", note: "conta da SOPA na Hive, criada em 11/09/2026" },
  ],
  // Persona das peças de campanha. Sem isto o gerador se apresentava como "the
  // growth lead at SOPA — a community-owned platform built on Hive", que é a
  // SkateHive, não a agência.
  campaignArtifacts: {
    persona: "the marketing lead at SOPA — a crypto-native agency that builds and operates community products (SkateHive, Gnars, swaps.pro) and sells that as a service",
    voiceHint: "Direct, builder-to-builder, no hype words. Show the work (what shipped, what it does), name the product, one idea per post. Portuguese only when the direction asks for it.",
  },
  // "/" is the SOPA home: an aggregated morning briefing with every project's
  // next actions (see src/app/page.tsx + components/sopa-briefing.tsx).
  //
  // Campanhas, sugestões de post e analytics deixaram de ser escondidos em
  // 15/09/2026: a SOPA tem redes e um site (sopa.team) para cuidar. O analytics
  // mostra o passo a passo até existir uma propriedade GA4 do sopa.team.
  // Userbase e brain continuam fora: são da SkateHive (contas do app) e do
  // agente de marca.
  hiddenRoutes: [
    "/userbase",
    "/brain",
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
  // Conversa longa com o agente da SOPA, em página inteira.
  chat: true,
  meetings: true,
  // SOPA is the hub: its Kanban aggregates every registered portal's board
  // (read-only). Reelflip's board drops out automatically now that the project
  // is unregistered — no need to disable the whole aggregate.
  kanbanAggregate: true,
  // SOPA's OWN board (org sopa-agency, Project #1 "SOPA · Reorg & Ops"). Wiring
  // it here makes it one of the sources the aggregate pulls in — so SOPA's own
  // ops/reorg tasks show on the SOPA Kanban alongside every portal's board.
  githubProject: {
    org: "sopa-agency",
    number: 1,
  },
  treasury: {
    ethWallets: [
      // SOPA's own multisig (Safe on Base). ETH + USDC + the Moonwell vault are
      // read by default; USDCx and $gnars are extra known tokens the Safe holds.
      {
        label: "SOPA Safe",
        address: "0x96C37393B79aD7EABdF9Ccf82C2EDAd3d3c0eEA2",
        // SafeProxy → SafeL2 na Base, 2 de 5.
        safe: { chainId: 8453 },
        extraTokens: [
          // Superfluid Super USDC — SuperToken balanceOf is real-time (includes
          // CFA stream deltas), priced 1:1. NOTE: GDA pool claimable is NOT in
          // balanceOf — flagged as a known limitation until we read the pool.
          { chain: "base", address: "0xD04383398dD2426297da660F9CCA3d439AF9ce1b", symbol: "USDCx", decimals: 18, usd: "one", note: "claimable de pool GDA não incluído" },
          // $GNARS (Clanker) — illiquid, no trustworthy price → quantity only.
          { chain: "base", address: "0x0cf0c3b75d522290d7d12c74d7f1f0cc47ccb23b", symbol: "gnars", decimals: 18, usd: "none" },
        ],
      },
    ],
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
