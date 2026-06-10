import type { PostType } from "@/app/actions/post-creator";

/**
 * Default prompts for the Post Creator AI actions, shared by the server
 * actions (which run them) and the client (whose "Edit prompt" UI shows them
 * as the starting point for a custom prompt). Pure string builders — keep
 * them free of server-only imports so the client bundle can use them.
 */

const FORMAT_HINT: Record<PostType, string> = {
  IMAGE: "single image post",
  CAROUSEL: "carousel post (multi-slide narrative)",
  REELS: "Reel (short-form video caption)",
};

const IMPROVE_FORMAT_HINT: Record<PostType, string> = {
  IMAGE: "single image post",
  CAROUSEL: "carousel post",
  REELS: "Reel",
};

export function buildGenerateCaptionPrompt(params: {
  agentName: string;
  topic: string;
  type: PostType;
}): string {
  return `You are the ${params.agentName} Instagram content agent.

Read your brand playbook (docs/playbook.md) for voice rules, content formats, hero lines, and what NOT to do.

Write an Instagram caption for a ${FORMAT_HINT[params.type]} about:
"${params.topic}"

Rules:
- Write in the brand voice as defined in your playbook.
- Keep it under 2200 characters total.
- Instagram-native formatting: line breaks are fine, no markdown.
- Use hashtags ONLY if the playbook says they're on-brand for this format; when in doubt keep them minimal or omit entirely.
- Return ONLY the caption text — no preamble, no explanation, no quotes wrapping it.`;
}

export function buildImproveCaptionPrompt(params: {
  agentName: string;
  caption: string;
  type: PostType;
}): string {
  return `You are the ${params.agentName} Instagram content agent.

Read your brand playbook (docs/playbook.md) for voice rules and what makes a great ${IMPROVE_FORMAT_HINT[params.type]} caption.

Refine the following Instagram caption to be sharper, more on-brand, and more effective — while preserving the author's intent:

---
${params.caption}
---

Rules:
- Keep it under 2200 characters.
- Preserve the essential idea but tighten the language and make it more on-voice.
- Instagram-native formatting only (line breaks ok, no markdown).
- Return ONLY the improved caption — no explanation, no commentary.`;
}
