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

// Step IDs — used to compute the visible sequence.
export type StepId =
  | "type"
  | "media"
  | "format"
  | "caption"
  | "firstComment"
  | "tags"
  | "collaborators"
  | "more"
  | "review";

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
  // "format" applies to every type — for REELS it's the preview-crop control.
  const steps: StepId[] = ["type", "media", "format"];
  steps.push("caption", "firstComment");
  if (postType === "IMAGE") steps.push("tags");
  steps.push("collaborators", "more", "review");
  return steps;
}
