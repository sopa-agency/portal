import type { ProjectConfig } from "./types";

const coletivoxv: ProjectConfig = {
  slug: "coletivoxv",
  // Paused project — out of the switcher, URL keeps working for the revival.
  switcher: { rank: 40, parent: "reelflip", hidden: true },
  name: "ColetivoXV",
  description: "Internal ops portal for ColetivoXV.",
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
  ],
  theme: {
    accentLight: "#6d28d9",
    accentDark: "#a78bfa",
    accentBgLight: "rgba(109, 40, 217, 0.1)",
    accentBgDark: "rgba(167, 139, 250, 0.12)",
    accentBorderLight: "rgba(109, 40, 217, 0.3)",
    accentBorderDark: "rgba(167, 139, 250, 0.35)",
    logo: "/projects/coletivoxv/logo.svg",
  },
  hive: {
    account: "coletivoxv",
    community: "hive-173115",
    frontend: "https://coletivoxv.org",
  },
  farcaster: {
    channel: "coletivoxv",
  },
  repos: [
    "sktbrd/coletivoxv-site",
  ],
  socials: [
    {
      platform: "Instagram",
      handle: "@coletivoxv",
      url: "https://www.instagram.com/coletivoxv/",
      note: "Canal público principal da frente cultural",
      summary:
        "Canal editorial e de mobilização do ColetivoXV, conectando memória urbana, skate, cultura e território.",
      cadence: "Por campanha, evento e série editorial.",
      voice: "Cultural, territorial, direto e comunitário.",
      formats: [
        {
          name: "Carrosséis editoriais",
          description: "Séries como PERSPECTIVA, memória urbana, acervo e chamadas de evento.",
        },
      ],
      dos: ["Preservar contexto histórico", "Conectar território, memória e uso do espaço"],
      donts: ["Não cair em copy genérica de marca", "Não perder a voz comunitária"],
    },
  ],
  postCreator: true,
  briefingAgents: [
    { slug: "municipela", label: "Municipela", tabLabel: "MUNI", workspace: "workspace-municipela" },
  ],
  agent: {
    gatewayEnvPrefix: "MUNICIPELA",
    id: "municipela",
    displayName: "Municipela",
    emoji: "🏛️",
    greeting: "Oi! Sou a Municipela. Posso ajudar com operação, memória e organização do ColetivoXV.",
  },
  teamEmails: [
    "coletivoxvcultural@gmail.com",
    "sktbrd.eth@gmail.com",
  ],
  githubProject: {
    org: "ReelflipOrg",
    number: 1,
  },
};

export default coletivoxv;
