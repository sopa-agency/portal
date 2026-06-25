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
