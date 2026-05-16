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
  // Prompts live versioned in the repo under prompts/{slug}.md so Vercel can
  // read them too. The Mac mini cron uses ~/.openclaw/workspace-*/docs/cron-prompts/
  // which is the same content — keep both in sync if you tweak either.
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
