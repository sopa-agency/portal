import type { ProjectConfig } from "./types";

/**
 * BurnDownWallStreet — lançador de token e marketplace na Solana onde todo
 * token nasce pareado contra uma ação tokenizada.
 *
 * Portal PRÓPRIO, e não uma página do swaps.pro, pela mesma doutrina que vale
 * para os influencers nesta base: uma marca ganha o próprio portal — próprio
 * subdomínio, próprio tema, próprio allowlist — em vez de virar uma linha numa
 * lista compartilhada. No switcher ele indenta debaixo do swaps.pro, porque é
 * o mesmo assunto visto do outro lado: lá se negociam as ações da Coinbase na
 * Base, aqui se lançariam tokens pareados contra elas na Solana.
 *
 * Enxuto de propósito. O produto está na fase 0 — nenhum programa na cadeia —
 * então nada de agente, Hive, Farcaster ou tesouro. A única rota que importa é
 * o painel, e a home vai direto para ele.
 */
const wallstreet: ProjectConfig = {
  slug: "wallstreet",
  name: "BurnDownWallStreet",
  description:
    "Lançador de token e marketplace na Solana onde todo token nasce pareado contra uma ação tokenizada, e a política de taxa é escolhida uma vez, no deploy, e vira imutável na cadeia.",
  // Mesma tripulação do swaps.pro — é o mesmo time, do mesmo lado da mesa.
  allowlist: ["xvlad", "bielcx", "keepkey", "illithics", "humbertoperes", "r4topunk", "nogenta", "louzoshi", "highlander22", "vaipraonde"],
  theme: {
    // Laranja brasa — o acento livre que sobrou, e o único que o nome do
    // produto pedia (lime SkateHive, vermelho Gnars, âmbar SOPA, dourado
    // KeepKey, violeta Vlad, ciano swaps.pro, magenta Influencers).
    accentLight: "#c2410c",
    accentDark: "#fb923c",
    accentBgLight: "rgba(194, 65, 12, 0.1)",
    accentBgDark: "rgba(251, 146, 60, 0.12)",
    accentBorderLight: "rgba(194, 65, 12, 0.3)",
    accentBorderDark: "rgba(251, 146, 60, 0.35)",
    logo: "/projects/wallstreet/logo.svg",
  },
  hive: { account: "", community: "" },
  farcaster: { channel: "" },
  repos: ["sktbrd/burndownwallstreet"],
  socials: [],
  // Indenta debaixo do swaps.pro (110), acima da divisória dos Influencers (120).
  switcher: { rank: 115, parent: "swaps" },
  // O painel É o portal: a home manda direto para ele em vez de mostrar um
  // briefing matinal de um produto que ainda não tem manhã.
  homeRoute: "/burndown",
  burnDown: true,
  briefingAgents: [],
  agent: {
    // Reserva o prefixo; nenhum gateway configurado ainda.
    gatewayEnvPrefix: "WALLSTREET",
    id: "wallstreet",
    displayName: "BurnDownWallStreet",
    emoji: "🔥",
    greeting: "Fala! Sou o agente do BurnDownWallStreet. O produto está na fase 0 — pergunta o que quiser sobre a pesquisa da Doppler.",
  },
};

export default wallstreet;
