"use server";

import { createPinataSignedUploadUrl } from "@/lib/social-publish";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { buildGenerateCaptionPrompt, buildImproveCaptionPrompt } from "@/lib/post-creator-prompts";
import type { PostType } from "@/app/actions/post-creator";
import { getActiveProject } from "@/projects/index";

const LAB_AI_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 120_000);

type TextResult = { ok: true; text: string } | { ok: false; error: string };

async function labGate() {
  const project = await getActiveProject();
  if (!project.lab) throw new Error("Lab is not enabled for this project.");
  return project;
}

/** Improve the current text with the project agent (lab-scoped — no Post Creator
 *  requirement). Reuses the same prompt the Post Creator uses. */
export async function labImproveText(text: string, type: PostType): Promise<TextResult> {
  try {
    const project = await labGate();
    if (!text.trim()) return { ok: false, error: "Nothing to improve." };
    const prompt = buildImproveCaptionPrompt({ agentName: project.agent.displayName, caption: text, type });
    const out = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!out) return { ok: false, error: "Agent returned empty." };
    return { ok: true, text: out.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Generate fresh text from a topic with the project agent. */
export async function labGenerateText(topic: string, type: PostType): Promise<TextResult> {
  try {
    const project = await labGate();
    if (!topic.trim()) return { ok: false, error: "Give a topic first." };
    const prompt = buildGenerateCaptionPrompt({ agentName: project.agent.displayName, topic, type });
    const out = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!out) return { ok: false, error: "Agent returned empty." };
    return { ok: true, text: out.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Campaign-style fan-out: tailor the base message per channel in one agent
 *  call. Returns a map of networkId → text. Channels carry their own norms. */
export async function labGenerateVariants(
  baseText: string,
  networks: { id: string; label: string; rule: string }[],
): Promise<{ ok: true; variants: Record<string, string> } | { ok: false; error: string }> {
  try {
    const project = await labGate();
    if (!baseText.trim()) return { ok: false, error: "Write a base message first." };
    if (!networks.length) return { ok: false, error: "No channels selected." };
    const list = networks.map((n) => `- "${n.id}" (${n.label}): ${n.rule}`).join("\n");
    const prompt = `You are the ${project.agent.displayName} content lead. Read your brand playbook (docs/playbook.md) for voice.

Take this base message and write a tailored version for EACH channel below, respecting each channel's norms and limits:

BASE MESSAGE:
"""
${baseText}
"""

CHANNELS:
${list}

Return ONLY a JSON object mapping each channel id to its tailored text, e.g. {"hive":"...","farcaster":"..."}. No preamble, no code fences.`;
    const raw = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!raw) return { ok: false, error: "Agent returned empty." };
    const jsonStr = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const variants: Record<string, string> = {};
    for (const n of networks) {
      const v = parsed[n.id];
      if (typeof v === "string" && v.trim()) variants[n.id] = v.trim();
    }
    if (!Object.keys(variants).length) return { ok: false, error: "No variants parsed from the agent output." };
    return { ok: true, variants };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Signed-URL handshake for the Lab composer's media uploads, gated by the `lab`
// flag (so it works regardless of whether the project has Post Creator).
export async function signLabMediaUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    if (!project.lab) return { ok: false, error: "Lab is not enabled for this project." };
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
