import type { ProjectConfig } from "./types";

// swaps.pro — the swap/bridge product in the KeepKey family, and one
// of SOPA's live revenue streams: the EVM swap split pays SOPA 20%, and the
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
    //
    // NÃO é a cor da marca: o swaps.pro é verde (#4DF98A → #12A34F, o gradiente
    // do próprio logo). O ciano foi escolhido por ser distinto dos outros
    // portais, e trocar por verde colidiria com o lime da SkateHive — que é
    // justamente o motivo de existir o ciano. Fica como está até alguém decidir
    // qual das duas coisas importa mais: fidelidade à marca ou distinção entre
    // portais. É decisão de design, não achado de código.
    accentLight: "#0e7490",
    accentDark: "#22d3ee",
    accentBgLight: "rgba(14, 116, 144, 0.1)",
    accentBgDark: "rgba(34, 211, 238, 0.12)",
    accentBorderLight: "rgba(14, 116, 144, 0.3)",
    accentBorderDark: "rgba(34, 211, 238, 0.35)",
    // Marca real, tirada do repo do produto (public/icon.svg do swapspro).
    // Escolhi essa variante e não a `swaps-mark-solid.svg`: aquela tem um
    // hexágono quase preto (#050A06) por baixo, que some no tema escuro — e
    // aqui os dois temas são obrigatórios.
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
   * SEM TESOURO PRÓPRIO — e isso é a resposta, não uma lacuna.
   *
   * A fee do swaps.pro não fica com ele: aponta para o parceiro KeepKey
   * (coinmastersguild.eth) e para o ENS da SOPA. Então não existe carteira da
   * marca para somar, e o split que eu tinha posto aqui antes era justamente o
   * dinheiro que NÃO é dela — a distribuição para os outros dois.
   *
   * O bloco fica com a lista vazia de propósito. Sem ele, a página inteira vira
   * guia de configuração e a receita some junto; com ele vazio, a página abre e
   * o assunto dela passa a ser o que realmente existe: as fontes de receita,
   * que vêm do card do org-chart e já casam por nome.
   *
   * E o hero não diz "$0": conjunto vazio não é o mesmo que somar e dar zero.
   * Ele diz "sem tesouro próprio", em cinza e não em amarelo, porque isto é uma
   * resposta correta e não uma falha de leitura.
   */
  treasury: {
    ethWallets: [],
  },
  // Sits right under KeepKey, below the divider that separates that org from
  // the Reelflip family.
  switcher: { rank: 110, parent: "keepkey" },
  briefingAgents: [],
  // O board já existia: coinmastersguild/projects/2 tem os 11 issues do
  // coinmastersguild/swapspro (subdomínio app.swaps.pro, ZEROX_API_KEY em prod,
  // LI.FI como integrador, o bug de firmware do KeepKey). Não criamos um novo —
  // seria duplicar o quadro onde a equipe já trabalha.
  githubProject: {
    org: "coinmastersguild",
    number: 2,
  },
  /**
   * Reusa o AGENTE do KeepKey, e só ele.
   *
   * `gatewayFrom: "KEEPKEY"` empresta a computação — gateway e device keys.
   * `gatewayEnvPrefix: "SWAPS"` mantém a identidade própria: qualquer
   * credencial de postar (Hive, Farcaster, Discord, Instagram, TikTok,
   * Binance) continua sendo procurada como SWAPS_*, e nunca como KEEPKEY_*.
   *
   * Sem essa separação o caminho óbvio seria trocar o gatewayEnvPrefix para
   * "KEEPKEY" — e aí o swaps.pro passaria a postar COMO KeepKey no dia em que
   * alguém setasse uma credencial de identidade do KeepKey. A mudança que
   * armaria a bomba não teria nada a ver com o swaps, que é o que a tornaria
   * difícil de rastrear.
   *
   * Hoje nenhum dos dois prefixos tem variável neste ambiente: isto liga o
   * encanamento antes da água. É de propósito — o encanamento certo tem que
   * existir antes de alguém precisar dele com pressa.
   */
  agent: {
    gatewayEnvPrefix: "SWAPS",
    gatewayFrom: "KEEPKEY",
    id: "swaps",
    displayName: "swaps.pro",
    emoji: "🔁",
    greeting: "Hey! I'm the swaps.pro agent. How can I help you today?",
  },
};

export default swaps;
