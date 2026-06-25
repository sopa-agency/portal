// Team member skill categories for the radar chart. Add/remove here — the radar,
// sliders and storage all derive from this list. Values are 0–100 per category.

export const SKILL_CATEGORIES = [
  { key: "dev", label: "Dev" },
  { key: "writing", label: "Writing" },
  { key: "videoEditing", label: "Video Editing" },
  { key: "skateboarding", label: "Skateboarding" },
  { key: "eventProducing", label: "Event Producing" },
  { key: "design", label: "Design" },
  { key: "marketing", label: "Marketing / Growth" },
  { key: "community", label: "Community / Mod" },
  { key: "photography", label: "Photography" },
  { key: "music", label: "Music / Audio" },
] as const;

export type SkillKey = (typeof SKILL_CATEGORIES)[number]["key"];
export type Skills = Partial<Record<SkillKey, number>>;

// Short contribution phrase per skill — what someone strong here actually does.
const CONTRIBUTION: Record<SkillKey, string> = {
  dev: "dev do site, portal e automações",
  writing: "textos, posts e newsletters",
  videoEditing: "edição de edits, recaps e reels",
  skateboarding: "skate, filmagem de linhas e validação do conteúdo",
  eventProducing: "produção de eventos, sessions e ativações",
  design: "artes, identidade visual e thumbnails",
  marketing: "growth, campanhas e métricas",
  community: "moderação e engajamento da comunidade",
  photography: "fotografia de spots, eventos e produtos",
  music: "trilha, áudio e som dos edits",
};

// Skill clusters → an archetype label, picked by whichever cluster scores highest.
const CLUSTERS: { label: string; keys: SkillKey[] }[] = [
  { label: "maker / produto", keys: ["dev", "design"] },
  { label: "criativo / conteúdo", keys: ["videoEditing", "photography", "music", "skateboarding"] },
  { label: "growth / comunicação", keys: ["marketing", "community", "writing"] },
  { label: "operações / eventos", keys: ["eventProducing"] },
];

export type ContributionProfile = {
  /** "Perfil criativo / conteúdo" — null when there aren't enough points yet. */
  archetype: string | null;
  /** Contribution phrases for strong skills (can lead / own these). */
  lead: string[];
  /** Contribution phrases for solid mid skills (can help with these). */
  support: string[];
  /** A ready-to-render sentence built from the above. */
  summary: string;
};

/**
 * Describe — deterministically, NO AI — what a member can contribute from their
 * skill stats: an archetype + what they can lead vs. help with. Recomputes live
 * as the trait sliders change.
 */
export function describeContribution(input: Skills | Record<string, number>): ContributionProfile {
  const skills = sanitizeSkills(input);
  const scored = SKILL_CATEGORIES
    .map(({ key }) => ({ key: key as SkillKey, v: skills[key] ?? 0 }))
    .sort((a, b) => b.v - a.v);

  // Not enough signal yet.
  if (scored.every((s) => s.v < 20)) {
    return { archetype: null, lead: [], support: [], summary: "Defina os atributos para ver o que esse membro pode contribuir." };
  }

  const lead = scored.filter((s) => s.v >= 70).slice(0, 3).map((s) => CONTRIBUTION[s.key]);
  const support = scored
    .filter((s) => s.v >= 45 && s.v < 70)
    .slice(0, 3)
    .map((s) => CONTRIBUTION[s.key]);
  // Fallback: if nothing crosses the "lead" bar, the single top skill leads.
  if (lead.length === 0 && scored[0].v >= 20) lead.push(CONTRIBUTION[scored[0].key]);

  // Archetype = cluster with the highest summed score.
  const topCluster = CLUSTERS
    .map((c) => ({ label: c.label, score: c.keys.reduce((s, k) => s + (skills[k] ?? 0), 0) }))
    .sort((a, b) => b.score - a.score)[0];
  const archetype = topCluster && topCluster.score > 0 ? topCluster.label : null;

  const join = (arr: string[]) =>
    arr.length <= 1 ? arr[0] ?? "" : `${arr.slice(0, -1).join(", ")} e ${arr[arr.length - 1]}`;

  const parts: string[] = [];
  if (archetype) parts.push(`Perfil ${archetype}.`);
  if (lead.length) parts.push(`Pode puxar ${join(lead)}.`);
  if (support.length) parts.push(`Também contribui com ${join(support)}.`);
  return { archetype, lead, support, summary: parts.join(" ") };
}

/** Clamp + keep only known keys (0–100 ints). Used server-side before saving. */
export function sanitizeSkills(input: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object") return out;
  const rec = input as Record<string, unknown>;
  for (const { key } of SKILL_CATEGORIES) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return out;
}
