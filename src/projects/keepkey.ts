import type { ProjectConfig } from "./types";

// KeepKey — separate org from the Reelflip family (rendered below a divider
// in the switcher). The agent is being built now: when KEEPKEY_GATEWAY_URL /
// KEEPKEY_GATEWAY_TOKEN (and the rest of the KEEPKEY_* envs) land, the chat,
// briefings and publishing light up; until then every module shows its setup
// guide.
const keepkey: ProjectConfig = {
  slug: "keepkey",
  name: "KeepKey",
  description: "Internal ops portal for KeepKey — the hardware wallet.",
  allowlist: ["xvlad", "keepkey", "illithics", "humbertoperes", "r4topunk"],
  theme: {
    // KeepKey gold on black.
    accentLight: "#9a6a1d",
    accentDark: "#d4af37",
    accentBgLight: "rgba(154, 106, 29, 0.1)",
    accentBgDark: "rgba(212, 175, 55, 0.12)",
    accentBorderLight: "rgba(154, 106, 29, 0.3)",
    accentBorderDark: "rgba(212, 175, 55, 0.35)",
    logo: "/projects/keepkey/logo.svg",
  },
  // Placeholders until the KeepKey agent/accounts are wired up.
  hive: {
    account: "keepkey",
    community: "",
  },
  farcaster: {
    channel: "keepkey",
  },
  repos: [],
  socials: [
    {
      platform: "X",
      handle: "@keepkey",
      url: "https://x.com/keepkey",
      summary:
        "KeepKey's public channel — strategy to be defined as the agent comes online.",
    },
  ],
  switcher: { rank: 100, dividerBefore: true },
  briefingAgents: [
    {
      slug: "keepkey-awesome",
      label: "KeepKey Awesome",
      tabLabel: "BRIEF",
      workspace: "workspace-keepkey-awesome",
    },
  ],
  // Matches the OpenClaw agent id exactly — brain, chat and briefings all
  // resolve workspace-keepkey-awesome from it.
  agent: {
    gatewayEnvPrefix: "KEEPKEY",
    id: "keepkey-awesome",
    displayName: "KeepKey Awesome",
    emoji: "🔑",
    greeting: "Hey! I'm the KeepKey agent. How can I help you today?",
  },
};

export default keepkey;
