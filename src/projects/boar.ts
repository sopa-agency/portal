import type { ProjectConfig } from "./types";

/**
 * BOAR — "Adaptive Local Intelligence": app Android de pesquisa que roda
 * offline no aparelho (llama.cpp + biblioteca da Wikipedia no próprio
 * telefone), open source (MIT), feito por vaipraonde (rferrari / @arferrari)
 * e Vlad (xvlad / sktbrd). Entrou no bounty #31 do POIDH (claim #124).
 *
 * Portal enxuto: sem Hive, sem canal de Farcaster, sem tesouro. As contas da
 * MARCA no X e no Farcaster ainda não existem — TODO: quando existirem, entram
 * em `socials`. Nada de handle inventado aqui.
 *
 * Token: $boar na Base, 0x0cbf291Ba052174879d90bf781dF1A5F2BC5Bb07 (Clanker,
 * lançado por @vaipraonde em 26/09/2026). Não entra em `treasury`: o tipo só
 * lê saldos de carteiras, e a única carteira conhecida (admin do Clanker,
 * 0x32d1…5Ed) é pessoal do builder, não um tesouro do projeto verificado.
 */
const boar: ProjectConfig = {
  slug: "boar",
  name: "BOAR",
  description:
    "Internal ops portal for BOAR — an open-source Android research app that runs fully offline, on the phone.",
  allowlist: ["xvlad", "vaipraonde"],
  teamContacts: {
    vaipraonde: [
      { label: "GitHub", value: "rferrari", url: "https://github.com/rferrari" },
      { label: "X", value: "@arferrari", url: "https://x.com/arferrari" },
      { label: "Farcaster", value: "@vaipraonde", url: "https://farcaster.xyz/vaipraonde" },
    ],
    xvlad: [{ label: "GitHub", value: "sktbrd", url: "https://github.com/sktbrd" }],
  },
  theme: {
    // Verde-floresta — offline, trilha, sem sinal. Distinto de lime (SkateHive),
    // vermelho (Gnars), âmbar (SOPA), dourado (KeepKey), violeta (Vlad), ciano
    // (swaps.pro), magenta (Influencers), laranja (BurnDownWallStreet).
    accentLight: "#15803d", // green-700
    accentDark: "#4ade80", // green-400
    accentBgLight: "rgba(21, 128, 61, 0.1)",
    accentBgDark: "rgba(74, 222, 128, 0.12)",
    accentBorderLight: "rgba(21, 128, 61, 0.3)",
    accentBorderDark: "rgba(74, 222, 128, 0.35)",
    logo: "/projects/boar/logo.svg",
  },
  hive: { account: "", community: "" },
  farcaster: { channel: "" },
  repos: ["rferrari/boar-app"],
  // TODO: contas da marca (X / Farcaster) ainda não existem.
  socials: [],
  // Logo abaixo da SOPA, indentado — projeto do próprio time.
  switcher: { rank: 1, parent: "sopa" },
  campaignArtifacts: {
    persona:
      "the voice of BOAR — an open-source Android app that works as an offline research assistant: a local LLM grounded in an offline Wikipedia library, sources on every answer, nothing leaving the phone, and benchmarks of itself published in the repo",
    voiceHint:
      "Plain, specific, builder-to-builder. No hype, no superlatives. Never invent numbers: only cite figures that appear in the repo, the release or the briefing. State limits openly. Never claim BOAR won the POIDH bounty, is as good as frontier models, or is endorsed by Vitalik.",
  },
  briefingAgents: [
    {
      slug: "boar",
      label: "BOAR",
      tabLabel: "BRIEF",
      workspace: "workspace-boar",
      role: "dev",
    },
  ],
  // Casa exatamente com o agente do OpenClaw (id "boar", workspace-boar). Chat
  // e briefing acendem quando BOAR_GATEWAY_URL / BOAR_GATEWAY_TOKEN existirem.
  agent: {
    gatewayEnvPrefix: "BOAR",
    id: "boar",
    displayName: "BOAR",
    emoji: "🐗",
    greeting: "Oi! Sou o agente do BOAR. Pergunta sobre o app, o repo ou o bounty.",
  },
};

export default boar;
