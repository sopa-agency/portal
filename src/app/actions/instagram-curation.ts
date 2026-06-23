"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import {
  fetchInstagramCommentThreads,
  replyToInstagramComment,
  setInstagramCommentHidden,
  invalidateInstagramComments,
  type IgPostThread,
} from "@/lib/instagram-publish";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import type { ProjectConfig } from "@/projects/types";

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, project };
}

export async function listInstagramComments(): Promise<
  { ok: true; threads: IgPostThread[]; project: string; selfUsername: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await fetchInstagramCommentThreads(g.project);
  if (!res.ok) return res;
  return { ok: true, threads: res.threads, project: g.project.name, selfUsername: res.selfUsername };
}

export async function postInstagramReply(
  commentId: string,
  message: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await replyToInstagramComment(g.project, commentId, message);
  if (res.ok) invalidateInstagramComments(g.project);
  return res;
}

export async function toggleInstagramCommentHidden(
  commentId: string,
  hidden: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await setInstagramCommentHidden(g.project, commentId, hidden);
  if (res.ok) invalidateInstagramComments(g.project);
  return res;
}

// ---------------------------------------------------------------------------
// AI reply suggestion — a short, human, on-brand draft for a comment.
// ---------------------------------------------------------------------------

const AI_TIMEOUT_MS = 30_000;

function igReplyPrompt(project: ProjectConfig, commentText: string, caption?: string): string {
  const voice = project.socials.find((s) => s.voice)?.voice ?? `${project.name}'s authentic, culture-native voice`;
  return `You manage ${project.name}'s Instagram. Reply to a follower's comment on one of our posts — sound like a real, warm person running the account, NOT a corporate brand or a marketer.

${project.name}'s vibe (reference, don't imitate corporate tone): ${voice}
${caption ? `\nPost caption: """${caption.slice(0, 400)}"""` : ""}

The follower's comment:
"""
${commentText}
"""

Rules:
- Reply in the SAME language as the comment.
- VERY short — one line, usually under 100 characters. React to what they actually said.
- Warm, human, a little playful. Lowercase is fine.
- At most one emoji, only if natural. No hashtags, no slogans, no marketing words.

Output ONLY the reply text, nothing else.`;
}

export async function generateInstagramReply(
  commentText: string,
  caption?: string,
): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!commentText.trim()) return { ok: false, error: "Comentário vazio." };
  try {
    const raw = await callOpenClaw(igReplyPrompt(g.project, commentText, caption), g.project.agent.id, {
      timeoutMs: AI_TIMEOUT_MS,
      project: g.project,
    });
    return { ok: true, draft: raw.trim().replace(/^["']|["']$/g, "").slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na IA." };
  }
}
