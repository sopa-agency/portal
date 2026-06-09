import type { ProjectConfig } from "./types";

const coletivoxv: ProjectConfig = {
  slug: "coletivoxv",
  name: "ColetivoXV",
  description: "Internal ops portal for ColetivoXV.",
  allowlist: [
    "xvlad",
    "louzoshi",
    "willdias",
    "reelflip",
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
  hiddenRoutes: ["/userbase", "/repo-to-social", "/analytics"],
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
    org: "sktbrd",
    number: 8,
  },
};

export default coletivoxv;
