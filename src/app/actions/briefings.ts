"use server";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { BRIEFING_AGENTS, todayIsoDate } from "@/lib/morning-briefing";
import { callOpenClaw } from "@/lib/openclaw-gateway";

const TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 5 * 60_000);
const ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");

export type BriefingLanguage = "pt" | "en";

// Convenience for local dev on the Mac mini: fill GATEWAY_TOKEN from
// ~/.openclaw/.env so the action works with zero env config locally.
async function ensureLocalGatewayToken(): Promise<void> {
  if (process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN) return;
  try {
    const raw = await fs.readFile(ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let val = m[1];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env.GATEWAY_TOKEN = val;
      return;
    }
  } catch {
    // env file unreadable — caller will surface the proper "token missing" error.
  }
}

async function readPrompt(agentSlug: string): Promise<string> {
  // DB-backed overrides win (set by the "Improve prompt" → Apply flow).
  // Otherwise fall back to the repo-versioned default at prompts/{slug}.md.
  // The Mac mini cron still reads its own copy under
  // ~/.openclaw/workspace-*/docs/cron-prompts/ — sync manually if you want
  // the daily cron to match the override.
  try {
    const override = await prisma.briefingPromptOverride.findUnique({
      where: { agentSlug },
    });
    if (override?.body?.trim()) return override.body;
  } catch {
    // DB unreachable — fall through to file.
  }
  const file = path.join(process.cwd(), "prompts", `${agentSlug}.md`);
  return fs.readFile(file, "utf8");
}

export async function regenerateBriefing(
  agentSlug: string,
  language: BriefingLanguage = "pt",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const agent = BRIEFING_AGENTS.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };

    let prompt: string;
    try {
      prompt = await readPrompt(agentSlug);
    } catch (err) {
      return {
        ok: false,
        error: `Cannot read prompt for ${agentSlug}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (language === "en") {
      prompt +=
        "\n\n## Language override\n" +
        "Write the entire briefing in English. Translate every section heading and bullet to English, " +
        "including the top-level title. Keep the same structural format (## headings, bullet lists).";
    }

    await ensureLocalGatewayToken();
    const text = await callOpenClaw(prompt, agentSlug, { timeoutMs: TIMEOUT_MS });
    if (!text) return { ok: false, error: "Empty briefing returned from gateway" };

    const date = todayIsoDate();
    await prisma.briefing.upsert({
      where: { agentSlug_date: { agentSlug, date } },
      create: {
        agentSlug,
        date,
        language,
        body: text,
        generatedBy: "manual",
      },
      update: {
        body: text,
        language,
        generatedBy: "manual",
        generatedAt: new Date(),
      },
    });

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type PromptImprovement = {
  critique: string;
  improvedPrompt: string;
  manualSetup: string[];
};

const META_PROMPT = `You are reviewing the daily-briefing prompt system for SkateHive's internal ops portal.

Below is the CURRENT prompt that generates one of the agents' morning briefings, and the LATEST briefing it produced. Your job:

1. Critique the briefing — what is shallow, missing, vague, or might be hallucinated? Be specific.
2. Propose a concrete REWRITE of the prompt that fixes those weaknesses. Preserve the structural template (## headings, bullet-list format, output sections). The improved prompt should still tell the agent which sources to consult and how to format the output.
3. List EXTERNAL setup the user needs to do manually so the agent has access to better data — e.g. "connect Linear API token", "give the agent access to GA4", "install the GitHub CLI". Only include items that aren't possible from inside the prompt itself.

Respond with ONLY a single JSON object, no commentary outside it, no markdown fences:
{
  "critique": "<plain-text 3-6 lines, each line a separate weakness>",
  "improvedPrompt": "<the full new prompt, ready to drop into prompts/{slug}.md>",
  "manualSetup": ["<each step phrased as an actionable task>", ...]
}`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/m.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

export async function improvePrompt(
  agentSlug: string,
): Promise<{ ok: true; improvement: PromptImprovement } | { ok: false; error: string }> {
  try {
    const latest = await prisma.briefing.findFirst({
      where: { agentSlug },
      orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
    });
    if (!latest) {
      return { ok: false, error: "No briefing yet for this agent — regenerate one first." };
    }
    const currentPrompt = await readPrompt(agentSlug);
    const input =
      `${META_PROMPT}\n\n===CURRENT PROMPT===\n${currentPrompt}\n\n===LATEST BRIEFING (${latest.date})===\n${latest.body}`;

    await ensureLocalGatewayToken();
    const raw = await callOpenClaw(input, agentSlug, { timeoutMs: TIMEOUT_MS });
    if (!raw) return { ok: false, error: "Empty response from gateway" };

    let parsed: unknown;
    try {
      parsed = extractJson(raw);
    } catch (err) {
      return {
        ok: false,
        error: `Could not parse JSON response: ${err instanceof Error ? err.message : String(err)}\n\nRaw response:\n${raw.slice(0, 600)}`,
      };
    }

    const obj = parsed as Partial<PromptImprovement>;
    if (
      typeof obj.critique !== "string" ||
      typeof obj.improvedPrompt !== "string" ||
      !Array.isArray(obj.manualSetup)
    ) {
      return { ok: false, error: "Response missing critique/improvedPrompt/manualSetup fields." };
    }

    return {
      ok: true,
      improvement: {
        critique: obj.critique,
        improvedPrompt: obj.improvedPrompt,
        manualSetup: obj.manualSetup.map((x) => String(x)),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyPromptImprovement(
  agentSlug: string,
  improvedPrompt: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const agent = BRIEFING_AGENTS.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };
    const trimmed = improvedPrompt.trim();
    if (!trimmed) return { ok: false, error: "Empty prompt" };

    await prisma.briefingPromptOverride.upsert({
      where: { agentSlug },
      create: { agentSlug, body: trimmed, updatedBy: "improve-prompt" },
      update: { body: trimmed, updatedBy: "improve-prompt" },
    });
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function revertPromptOverride(
  agentSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.briefingPromptOverride.delete({ where: { agentSlug } }).catch(() => null);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function regenerateAllBriefings(
  language: BriefingLanguage = "pt",
): Promise<{
  ok: boolean;
  results: Array<{ agent: string; ok: boolean; error?: string }>;
}> {
  const results = await Promise.all(
    BRIEFING_AGENTS.map(async (a) => {
      const r = await regenerateBriefing(a.slug, language);
      return { agent: a.slug, ok: r.ok, error: r.error };
    }),
  );
  return { ok: results.every((r) => r.ok), results };
}
