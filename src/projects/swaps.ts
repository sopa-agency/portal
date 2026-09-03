import type { ProjectConfig } from "./types";

// swaps.pro — the swap/bridge product in the KeepKey family, and one
// of SOPA's live revenue streams: the EVM swap split pays SOPA 50%, and the
// THORChain multi-affiliate memo `keep/thor1ujdj…:24/6` pays the KeepKey
// THORName 24 bps + SOPA 6 bps (= 20% of the 0.30% fee). Both are already
// tracked on the SOPA revenue orbit as project "swaps.pro"
// (src/lib/sopa-revenue-orbit.ts) — this portal is the ops side of the same
// brand. The brand is written "swaps.pro", lowercase, never "SwapPro".
//
// Deliberately minimal to start: no agent gateway, no Hive/Farcaster posting,
// no logo from the brand yet. Only the always-on modules (suggestions,
// campaigns, userbase, analytics, treasury, team, settings) are live; turn the
// feature flags on as the brand actually needs them.
const swaps: ProjectConfig = {
  slug: "swaps",
  name: "swaps.pro",
  // Da própria documentação para máquina do produto (swaps.pro/llms.txt), que
  // é a descrição que a marca publica de si mesma — melhor que uma paráfrase
  // nossa, e ela se mantém alinhada quando o produto mudar.
  description:
    "Terminal de swap cross-chain não-custodial, sem conta e sem chave de API — com HTTP público que agentes autônomos podem usar.",
  // Same crew as KeepKey, its sibling in the switcher. Trim or extend as the
  // swaps.pro team takes shape.
  allowlist: ["xvlad", "bielcx", "keepkey", "illithics", "humbertoperes", "r4topunk", "nogenta", "louzoshi", "highlander22", "vaipraonde"],
  theme: {
    // Cyan — the one accent no other portal uses (lime SH, red Gnars, amber
    // SOPA, gold KeepKey, violet Vlad, monochrome Nogenta).
    accentLight: "#0e7490",
    accentDark: "#22d3ee",
    accentBgLight: "rgba(14, 116, 144, 0.1)",
    accentBgDark: "rgba(34, 211, 238, 0.12)",
    accentBorderLight: "rgba(14, 116, 144, 0.3)",
    accentBorderDark: "rgba(34, 211, 238, 0.35)",
    // Placeholder mark — swap for the real swaps.pro asset when it lands.
    logo: "/projects/swaps/logo.svg",
  },
  // No Hive presence yet.
  hive: {
    account: "",
    community: "",
  },
  farcaster: {
    channel: "",
  },
  // Repo público do produto. O board de issues já aponta para a mesma org
  // (coinmastersguild/projects/2), então as duas pontas do GitHub combinam.
  repos: ["coinmastersguild/swapspro"],
  socials: [],
  /**
   * Tesouro — PROVISÓRIO, e o rótulo diz por quê.
   *
   * O único endereço EVM conhecido do swaps.pro é o 0xSplits que recebe as
   * taxas: dinheiro EM TRÂNSITO, do qual a SOPA leva METADE e o resto segue
   * para os demais destinatários. Não é uma carteira própria da marca.
   *
   * A fatia dizia 20% aqui e no rótulo abaixo. A cadeia diz 50%: o
   * `SplitUpdated` vigente reparte 50/50 entre a coinmastersguild.eth
   * (0x21c9…Ad3e) e o Safe da SOPA. A tela nunca errou o número, porque lê a
   * fatia ao vivo pelo getSplitConfig — quem errava era o texto em volta dela,
   * que é justamente o que alguém lê quando quer conferir se o número está
   * certo. Número lido e texto escrito à mão discordando é pior que não ter
   * texto: dá a impressão de confirmação.
   *
   * Ele entra rotulado como o que é, em vez de como "tesouro", porque o total
   * do hero soma tudo que estiver aqui — e um número que afirma posse de
   * dinheiro de terceiros é exatamente a classe de coisa que esta base passou
   * a semana removendo. O rótulo é o que impede a soma de mentir sozinha.
   *
   * Fica assim até a pergunta B8 ser respondida ("qual carteira é o tesouro do
   * swaps.pro"). Se a resposta for outra carteira, isto vira três linhas.
   */
  treasury: {
    ethWallets: [
      {
        label: "Split de taxas (em trânsito · SOPA 50%)",
        address: "0xAccF0dB4b6B55Ba692467988D0a1188f26428C2b",
      },
    ],
  },
  // Sits right under KeepKey, below the divider that separates that org from
  // the Reelflip family.
  switcher: { rank: 110, parent: "keepkey" },
  // BurnDownWallStreet mora debaixo do swaps.pro: é o mesmo assunto (ação
  // tokenizada como par) visto do outro lado — lá a gente negocia as ações da
  // Coinbase na Base, aqui a gente lançaria tokens pareados contra elas na
  // Solana. Fase 0; o painel diz isso em vez de fingir métrica.
  burnDown: true,
  // No agent online — the block reserves the SWAPS_* gateway prefix so the
  // chat/briefings light up the day SWAPS_GATEWAY_URL / _TOKEN are set.
  briefingAgents: [],
  // O board já existia: coinmastersguild/projects/2 tem os 11 issues do
  // coinmastersguild/swapspro (subdomínio app.swaps.pro, ZEROX_API_KEY em prod,
  // LI.FI como integrador, o bug de firmware do KeepKey). Não criamos um novo —
  // seria duplicar o quadro onde a equipe já trabalha.
  githubProject: {
    org: "coinmastersguild",
    number: 2,
  },
  agent: {
    /**
     * PENSA com o agente do KeepKey, FALA como swaps.pro.
     *
     * `id` é o agente que o gateway executa (`openclaw/<id>`). O swaps.pro não
     * tem agente próprio registrado lá — `openclaw/swaps` devolve
     * "Unknown agent 'swaps'", e era por isso que o repo-to-social daqui
     * falhava em silêncio. Aponta para o do KeepKey, que existe e é o que a
     * equipe já usa para este produto.
     *
     * `gatewayEnvPrefix` continua SWAPS de propósito, e essa metade importa:
     * qualquer credencial de PUBLICAR (Hive, Farcaster, Discord, Instagram,
     * TikTok) é procurada como SWAPS_*, nunca KEEPKEY_*. Compartilhar quem
     * pensa não é compartilhar quem assina.
     */
    gatewayEnvPrefix: "SWAPS",
    id: "keepkey-awesome",
    displayName: "swaps.pro",
    emoji: "🔁",
    greeting: "Hey! I'm the swaps.pro agent. How can I help you today?",
  },
};

export default swaps;
