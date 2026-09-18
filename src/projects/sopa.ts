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
    // HiveDevs: a comunidade dos devs que constroem na Hive (3,6 mil inscritos,
    // ~26 autores ativos em 15/09/2026). É onde uma agência dev conversa com
    // quem entende o que ela entrega. Estava apontado para a hive-173115, que é
    // a comunidade da SKATEHIVE — um snap da SOPA cairia lá assinado por @s0p4.
    // A Hive não tem escolha de comunidade por post no portal (o mag post e o
    // snap usam esta); LeoFinance (crypto/negócios) e HiveBR (português) são
    // as alternativas se um dia houver seletor. Publicar ainda depende de
    // SOPA_HIVE_POSTING_KEY, que não existe: até lá, rascunho e agenda.
    community: "hive-139531",
  },
  farcaster: {
    // Padrão só quando ninguém escolhe: o publish de cast tem seletor de canal
    // por envio (FarcasterChannelSelect). /build é o canal dos builders (38 mil
    // seguidores) e é o que combina com "mostrar o que foi entregue"; /dev,
    // /founders e /base ficam a um clique. O canal /sopa não existe, e não
    // precisa existir. O que falta é um signer da SOPA (o do banco está
    // revogado; era o fid da Gnars): Settings → conectar Farcaster.
    channel: "build",
  },
  // O repo do próprio portal: é onde a equipe mais trabalha, então é ele que
  // alimenta o que lê commits da SOPA.
  repos: ["sopa-agency/portal"],
  // As redes que a SOPA tem de fato (15/09/2026). O X é o que o site sopa.team
  // aponta; a Hive é a conta nova. Sem API do X, a métrica dele fica "n/d" e
  // o tweet é copiar e colar — o mesmo que vale para as outras marcas.
  socials: [
    {
      platform: "X",
      handle: "@sopaagency",
      url: "https://x.com/sopaagency",
      note: "conta da agência; o site sopa.team aponta para cá",
      summary: "The agency's X account — what SOPA ships and operates, builder to builder. No X API: tweets are drafted here and posted by hand.",
    },
    {
      platform: "Hive",
      handle: "@s0p4",
      url: "https://peakd.com/@s0p4",
      note: "conta da SOPA na Hive, criada em 11/09/2026",
      summary: "SOPA's Hive account. No posting key in the portal yet and no community of its own, so Hive pieces are drafts until that exists.",
    },
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
