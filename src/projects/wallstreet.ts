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
  // Em inglês como todo o resto deste portal — ela sai na tela, no switcher e
  // nos metadados.
  description:
    "A Solana token launcher and marketplace where every launched token is paired against a tokenized equity, and the fee policy is chosen once, at deploy, and is then immutable on chain.",
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
  // O repo saiu da conta pessoal do Vlad para a org da SOPA. A URL antiga
  // redireciona, mas a canônica é esta.
  repos: ["sopa-agency/burndownwallstreet"],
  // Board próprio, criado com o projeto e já ligado ao repo. As sete cartas de
  // partida são as perguntas abertas da pesquisa da Doppler — o trabalho que
  // de fato existe hoje, e não um quadro vazio.
  githubProject: { org: "sopa-agency", number: 2 },
  socials: [],
  // Indenta debaixo do swaps.pro (110), acima da divisória dos Influencers (120).
  switcher: { rank: 115, parent: "swaps" },
  // O painel É o portal: a home manda direto para ele em vez de mostrar um
  // briefing matinal de um produto que ainda não tem manhã.
  homeRoute: "/burndown",
  // Inglês travado: a marca fala com o mercado cripto, que não é o público dos
  // outros portais. Meio traduzido seria pior — a metade em português passaria
  // a parecer descuido em vez de escolha.
  forcedLocale: "en",
  burnDown: true,
  briefingAgents: [],
  // MESMO agente da KeepKey, de propósito: ele está virando um agente de
  // produtos cripto (KeepKey, swaps.pro, este), então dividir a memória entre
  // dois workspaces separaria contexto que quer ficar junto. O prefixo e o id
  // apontam para o gateway que já existe — nada novo para configurar.
  agent: {
    gatewayEnvPrefix: "KEEPKEY",
    id: "keepkey-awesome",
    displayName: "KeepKey Awesome",
    emoji: "🔑",
    greeting: "What do you want to know about BurnDownWallStreet? The product is at phase 0 — ask me about the Doppler research.",
  },
};

export default wallstreet;
