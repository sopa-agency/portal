// Post Creator — pure constants, types and helpers (no React/JSX, no side
// effects). Extracted from post-creator.tsx to slim it down.
import type { PostType } from "@/app/actions/post-creator";

export const CAPTION_MAX = 2200;
export const COMMENT_MAX = 2200;

export const POST_TYPES: { value: PostType; label: string; hint: string }[] = [
  { value: "IMAGE", label: "Single Image", hint: "1 image" },
  { value: "CAROUSEL", label: "Carousel", hint: "2–10 photos or videos" },
  { value: "REELS", label: "Reel", hint: "1 video" },
];

export type ViewTab = "create" | "studio" | "drafts" | "calendar";

// Step IDs — used to compute the visible sequence. Each step is now a *section*
// rendered inside one of the four top-level phases (see PhaseId), not a
// top-level wizard stop of its own.
export type StepId =
  | "title"
  | "type"
  | "media"
  | "format"
  | "caption"
  | "firstComment"
  | "tags"
  | "collaborators"
  | "more"
  | "review";

// Phases — the 4 top-level wizard stops. The user thinks: what am I posting
// (Brief), what does it look like (Creative), where is it going (Distribution),
// is it ready (Review). Each phase groups several StepId sections.
export type PhaseId = "brief" | "creative" | "distribution" | "review";

export const PHASES: { id: PhaseId; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "creative", label: "Creative" },
  { id: "distribution", label: "Distribution" },
  { id: "review", label: "Review" },
];

// Which phase each step section belongs to.
const STEP_PHASE: Record<StepId, PhaseId> = {
  title: "brief",
  type: "brief",
  media: "creative",
  format: "creative",
  caption: "creative",
  firstComment: "creative",
  tags: "distribution",
  collaborators: "distribution",
  more: "distribution",
  review: "review",
};

export function phaseForStep(step: StepId): PhaseId {
  return STEP_PHASE[step];
}

// The ordered step sections to render in a phase, given the visible step
// sequence for the current post type (so type-specific drops like "tags" or a
// locked "format" naturally fall away).
export function stepsInPhase(phase: PhaseId, steps: StepId[]): StepId[] {
  return steps.filter((s) => STEP_PHASE[s] === phase);
}

// ---- datetime-local helpers ----
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLocalDatetime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function computeSteps(postType: PostType): StepId[] {
  // "title" leads: naming the post first makes drafts identifiable in lists.
  // "format" applies to every type — for REELS it's the preview-crop control.
  const steps: StepId[] = ["title", "type", "media", "format"];
  steps.push("caption", "firstComment");
  if (postType === "IMAGE") steps.push("tags");
  steps.push("collaborators", "more", "review");
  return steps;
}
