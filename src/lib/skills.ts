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

// What the feature actually cares about is WORK contribution. Each work skill
// has a short role label (for the headline) + a phrase (what they do) + a weight
// that biases the ranking toward what matters most to the operation
// (dev / marketing / writing first). Skateboarding is intentionally NOT a work
// skill — it's a fun bonus line only, so it never dominates the read.
type WorkMeta = { role: string; phrase: string; weight: number };
const WORK: Partial<Record<SkillKey, WorkMeta>> = {
  dev: { role: "Dev", phrase: "construir e manter o site, portal e automações", weight: 1.15 },
  marketing: { role: "Growth", phrase: "campanhas, growth e leitura de métricas", weight: 1.15 },
  writing: { role: "Escrita", phrase: "posts, newsletters e copy", weight: 1.1 },
  design: { role: "Design", phrase: "identidade visual, artes e thumbnails", weight: 0.95 },
  videoEditing: { role: "Edição", phrase: "edição de edits, recaps e reels", weight: 0.9 },
  community: { role: "Comunidade", phrase: "moderar e engajar a comunidade", weight: 0.85 },
  eventProducing: { role: "Eventos", phrase: "produzir eventos, sessions e ativações", weight: 0.8 },
  photography: { role: "Foto", phrase: "fotografia de spots, eventos e produtos", weight: 0.75 },
  music: { role: "Áudio", phrase: "trilha, áudio e som dos edits", weight: 0.7 },
};

// Deterministic sentence variety (no AI, no RNG) — pick a template by a stable
// hash so different members read differently but the same stats always render
// the same text.
const LEAD_TEMPLATES = [
  (h: string, c: string) => `Forte em ${h}: ${c}.`,
  (h: string, c: string) => `Mão na massa em ${h} — ${c}.`,
  (h: string, c: string) => `Entrega melhor em ${h}: ${c}.`,
  (h: string, c: string) => `Carrega o lado de ${h} — ${c}.`,
];
const SUPPORT_TEMPLATES = [
  (c: string) => `Também soma em ${c}.`,
  (c: string) => `Dá conta também de ${c}.`,
  (c: string) => `Ajuda ainda com ${c}.`,
];
const SKATE_FLAVOR = [
  "E de quebra manda no skate. 🛹",
  "Bônus: skatista de verdade. 🛹",
  "(ainda por cima, anda de skate 🛹)",
];
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export type ContributionProfile = {
  /** Role headline from the top WORK skills, e.g. "Dev & Growth". null = no data. */
  archetype: string | null;
  /** Contribution phrases for strong work skills (can lead / own these). */
  lead: string[];
  /** Contribution phrases for solid mid work skills (can help with these). */
  support: string[];
  /** A ready-to-render sentence built from the above. */
  summary: string;
};

/**
 * Describe — deterministically, NO AI — what a member can contribute from their
 * skill stats: a role headline + what they can lead vs. help with, biased toward
 * the work that matters most (dev/growth/writing). Skateboarding is only a fun
 * bonus line. `seed` (the username) varies the phrasing so reads don't repeat.
 */
export function describeContribution(
  input: Skills | Record<string, number>,
  seed = "",
): ContributionProfile {
  const skills = sanitizeSkills(input);
  // Rank WORK skills by weighted score so dev/growth/writing surface first.
  const work = (Object.keys(WORK) as SkillKey[])
    .map((key) => ({ key, v: skills[key] ?? 0, meta: WORK[key]! }))
    .map((s) => ({ ...s, eff: s.v * s.meta.weight }))
    .sort((a, b) => b.eff - a.eff);
  const skate = skills.skateboarding ?? 0;

  if (work.every((s) => s.v < 20) && skate < 20) {
    return { archetype: null, lead: [], support: [], summary: "Defina os atributos para ver o que esse membro pode contribuir." };
  }

  const leadSkills = work.filter((s) => s.v >= 65).slice(0, 2);
  if (leadSkills.length === 0 && work[0]?.v >= 25) leadSkills.push(work[0]); // top work skill anchors it
  const leadKeys = new Set(leadSkills.map((s) => s.key));
  const supportSkills = work.filter((s) => s.v >= 40 && !leadKeys.has(s.key)).slice(0, 2);

  const lead = leadSkills.map((s) => s.meta.phrase);
  const support = supportSkills.map((s) => s.meta.phrase);
  const headline = leadSkills.map((s) => s.meta.role).join(" & ") || null;

  const join = (arr: string[]) =>
    arr.length <= 1 ? arr[0] ?? "" : `${arr.slice(0, -1).join(", ")} e ${arr[arr.length - 1]}`;
  const h = hashSeed(seed || work.map((s) => s.v).join(""));

  const parts: string[] = [];
  if (lead.length && headline) {
    parts.push(LEAD_TEMPLATES[h % LEAD_TEMPLATES.length](headline, join(lead)));
  }
  if (support.length) {
    parts.push(SUPPORT_TEMPLATES[h % SUPPORT_TEMPLATES.length](join(support)));
  }
  const hasWork = parts.length > 0;
  if (hasWork && skate >= 55) {
    // Skate is only a light bonus on top of real work contribution.
    parts.push(SKATE_FLAVOR[h % SKATE_FLAVOR.length]);
  } else if (!hasWork) {
    // No work signal yet — keep it human (skate is why they're around).
    parts.push("Skatista do time — atributos de trabalho ainda a definir. 🛹");
  }

  return { archetype: headline, lead, support, summary: parts.join(" ") };
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
