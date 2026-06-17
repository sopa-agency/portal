"use server";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { feedbackScope, feedbackPromptBlock } from "@/lib/insight-feedback";
import { getActiveProject } from "@/projects/index";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  getProjectSocialInsightsContext,
  getProjectSocialMetricsContext,
} from "@/lib/social-insights-core";
import { getProjectKanbanContext } from "@/lib/kanban-context";

// Abort the agent call a hair before the 300s function budget so the action
// returns a clean error instead of a raw 504 if a run goes long.
const TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 285_000);
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

/** Assemble the full briefing prompt (base + feedback + social + board). */
async function assembleBriefingPrompt(
  project: Awaited<ReturnType<typeof getActiveProject>>,
  agentSlug: string,
  language: BriefingLanguage,
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  let prompt: string;
  try {
    prompt = await readPrompt(agentSlug);
  } catch (err) {
    return {
      ok: false,
      error: `Cannot read prompt for ${agentSlug}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // Team corrections go FIRST, right after the base prompt.
  const feedback = await feedbackPromptBlock(feedbackScope("briefing", project.slug, agentSlug));
  if (feedback) prompt += `\n\n${feedback}`;

  if (language === "en") {
    prompt +=
      "\n\n## Language override\n" +
      "Write the entire briefing in English. Translate every section heading and bullet to English, " +
      "including the top-level title. Keep the same structural format (## headings, bullet lists).";
  }

  const ctx = await getProjectSocialInsightsContext(project.slug);
  if (ctx) {
    prompt +=
      "\n\n=== Social analytics context — the agent's prior AI analysis per channel (use when relevant) ===\n" + ctx;
  }

  // Live social numbers + GitHub Project board, in parallel — grounding the
  // agent should use as-is instead of re-fetching.
  const [liveNumbers, kanban] = await Promise.all([
    getProjectSocialMetricsContext(project),
    getProjectKanbanContext(project),
  ]);
  if (liveNumbers) {
    prompt +=
      "\n\n=== Social LIVE numbers, fetched THIS run — treat as current evidence, cite them, label [live] ===\n" +
      liveNumbers;
  }
  if (kanban) {
    prompt +=
      "\n\n=== GitHub Project board, fetched THIS run — current kanban state; ground priorities/blockers in it, label [board] ===\n" +
      kanban;
  }

  // Anchor for incremental work: the timestamp of this agent's last briefing.
  // Lets the agent bound its repo/code inspection to the delta since then
  // (e.g. `git log --since=[since]`) instead of re-scanning from scratch.
  const last = await prisma.briefing
    .findFirst({
      where: { agentSlug },
      orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
      select: { generatedAt: true },
    })
    .catch(() => null);
  const since = last?.generatedAt?.toISOString() ?? null;
  prompt +=
    "\n\n=== [since] Last briefing for this agent ===\n" +
    (since
      ? `${since}\nOnly inspect what changed since this instant. For any code/repo source, run a bounded delta since this timestamp (e.g. \`git log --since='${since}'\`) instead of scanning from scratch — use the exact path/command your own prompt specifies.`
      : "No prior briefing — this is the first run, so a fuller pass is fine.");

  if (feedback) {
    prompt +=
      "\n\nREMINDER: apply every item under '=== Team corrections to honor ===' above. They override default phrasing.";
  }
  return { ok: true, prompt };
}

// Regeneration is ENQUEUED, not run inline: Vercel can't reach the agent
// gateway over the Tailscale funnel (TLS handshake drops), so the portal
// assembles the prompt and writes a BriefingJob. The Mac mini worker (which
// reaches the local gateway at 127.0.0.1) runs it and writes the Briefing.
export async function regenerateBriefing(
  agentSlug: string,
  language: BriefingLanguage = "pt",
): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  try {
    const project = await getActiveProject();
    const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };

    const built = await assembleBriefingPrompt(project, agentSlug, language);
    if (!built.ok) return built;

    const job = await prisma.briefingJob.create({
      data: { agentSlug, projectSlug: project.slug, language, prompt: built.prompt },
    });
    return { ok: true, jobId: job.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type BriefingJobStatus = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
};

/** Poll the status of enqueued briefing jobs (client waits on these). */
export async function getBriefingJobs(ids: string[]): Promise<BriefingJobStatus[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.briefingJob.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, error: true },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status as BriefingJobStatus["status"],
    error: r.error,
  }));
}

export type PromptImprovement = {
  critique: string;
  improvedPrompt: string;
  manualSetup: string[];
};

const META_PROMPT = `You are reviewing the daily-briefing prompt system for this internal ops portal.

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
    const project = await getActiveProject();
    const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
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

function buildProposePrompt(brief: string): string {
  return [
    "You are being called from the portal Morning Briefing card.",
    "Read the briefing below and propose ONE concrete, safe next action for this project.",
    "IMPORTANT: do not execute anything yet. Return a concise confirmation-ready plan only.",
    "Format:",
    "## Proposed action",
    "- Objective: ...",
    "- Steps: ...",
    "- Risk/needs approval: ...",
    "- Expected result: ...",
    "",
    "Morning briefing:",
    brief,
  ].join("\n");
}

function buildExecutePrompt(brief: string, proposal: string): string {
  return [
    "The portal user approved the following action based on the Morning Briefing.",
    "Execute the approved safe action now. If you hit a blocker, report the exact blocker instead of improvising.",
    "After finishing, return a concise result with what changed and whether the Morning Briefing should be regenerated.",
    "",
    "Approved action:",
    proposal,
    "",
    "Morning briefing context:",
    brief,
  ].join("\n");
}

export type ActionTurn = { role: "agent" | "user"; text: string };

function buildFollowUpPrompt(
  brief: string,
  history: ActionTurn[],
  newInstruction: string,
): string {
  const transcript = history
    .map((t) => `### ${t.role === "agent" ? "Agent" : "User"}\n${t.text.trim()}`)
    .join("\n\n");
  return [
    "You are continuing a multi-turn action thread inside the portal's Morning Briefing card.",
    "Below is the conversation so far between the portal user and you (the project agent), followed by the user's NEW instruction.",
    "Carry out the new instruction. If it requires destructive or out-of-scope work, say so plainly instead of guessing.",
    "Return a concise result describing what changed (or what blocker stopped you).",
    "",
    "=== Conversation so far ===",
    transcript,
    "",
    "=== New instruction from user ===",
    newInstruction.trim(),
    "",
    "=== Morning briefing context ===",
    brief,
  ].join("\n");
}

async function loadLatestBriefingBody(agentSlug: string): Promise<string | null> {
  const row = await prisma.briefing.findFirst({
    where: { agentSlug },
    orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
  });
  if (!row?.body) return null;
  return row.body.trim().slice(0, 12000);
}

export async function proposeBriefingAction(
  agentSlug: string,
): Promise<{ ok: true; proposal: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };

    const brief = await loadLatestBriefingBody(agentSlug);
    if (!brief) return { ok: false, error: "No briefing yet for this agent — regenerate one first." };

    await ensureLocalGatewayToken();
    const proposal = await callOpenClaw(buildProposePrompt(brief), agentSlug, { timeoutMs: TIMEOUT_MS, project });
    if (!proposal) return { ok: false, error: "Empty proposal returned from gateway" };

    return { ok: true, proposal };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeBriefingAction(
  agentSlug: string,
  proposal: string,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };
    const trimmedProposal = proposal.trim().slice(0, 8000);
    if (!trimmedProposal) return { ok: false, error: "Empty proposal" };

    const brief = await loadLatestBriefingBody(agentSlug);
    if (!brief) return { ok: false, error: "No briefing yet for this agent — regenerate one first." };

    await ensureLocalGatewayToken();
    const result = await callOpenClaw(
      buildExecutePrompt(brief, trimmedProposal),
      agentSlug,
      { timeoutMs: TIMEOUT_MS, project },
    );
    if (!result) return { ok: false, error: "Empty result returned from gateway" };

    revalidatePath("/");
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function followUpBriefingAction(
  agentSlug: string,
  history: ActionTurn[],
  instruction: string,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };

    const trimmed = instruction.trim().slice(0, 4000);
    if (!trimmed) return { ok: false, error: "Empty follow-up instruction" };

    const brief = await loadLatestBriefingBody(agentSlug);
    if (!brief) return { ok: false, error: "No briefing yet for this agent — regenerate one first." };

    // Cap each turn so a runaway thread doesn't blow the gateway token budget.
    const cappedHistory = history.slice(-12).map((t) => ({
      role: t.role,
      text: (t.text ?? "").slice(0, 4000),
    }));

    await ensureLocalGatewayToken();
    const result = await callOpenClaw(
      buildFollowUpPrompt(brief, cappedHistory, trimmed),
      agentSlug,
      { timeoutMs: TIMEOUT_MS, project },
    );
    if (!result) return { ok: false, error: "Empty result returned from gateway" };

    revalidatePath("/");
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function regenerateAllBriefings(
  language: BriefingLanguage = "pt",
): Promise<{
  ok: boolean;
  jobIds: string[];
  results: Array<{ agent: string; ok: boolean; error?: string; jobId?: string }>;
}> {
  const project = await getActiveProject();
  const results = await Promise.all(
    project.briefingAgents.map(async (a) => {
      const r = await regenerateBriefing(a.slug, language);
      return { agent: a.slug, ok: r.ok, error: r.error, jobId: r.jobId };
    }),
  );
  const jobIds = results.map((r) => r.jobId).filter((id): id is string => !!id);
  return { ok: results.every((r) => r.ok), jobIds, results };
}

// ---------------------------------------------------------------------------
// Briefing email — render + send
// ---------------------------------------------------------------------------

/**
 * Render a briefing as an inline-styled HTML email suitable for common email
 * clients. Uses `marked` for markdown→HTML, then wraps in a minimal email
 * skeleton with project accent color in the hero header.
 */
function renderBriefingEmailHtml(
  project: { name: string; theme: { accentDark: string } },
  { title, date, markdownBody }: { title: string; date: string; markdownBody: string },
): string {
  // marked.parse is synchronous when called with a string (no async walk).
  // We import it dynamically at the top level but call it inline here via require-style.
  // Because this is server-only, we can use a sync require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { marked } = require("marked") as { marked: { parse: (md: string) => string } };
  const bodyHtml = marked.parse(markdownBody);

  const accent = project.theme.accentDark;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Hero header -->
        <tr>
          <td style="background:#0a0a0a;padding:32px 40px;">
            <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${escapeHtml(accent)};font-weight:600;">${escapeHtml(project.name)}</p>
            <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;color:#ffffff;">Morning Brief</h1>
            <p style="margin:0;font-size:13px;color:#a3a3a3;font-variant-numeric:tabular-nums;">${escapeHtml(date)}</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;color:#171717;font-size:15px;line-height:1.65;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #e5e5e5;font-size:12px;color:#a3a3a3;text-align:center;">
            ${escapeHtml(project.name)} · Morning Brief · ${escapeHtml(date)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send the latest morning briefing for `agentSlug` by email (BCC) to the
 * project's team. Auth-gated.
 */
export async function sendBriefingEmail(
  agentSlug: string,
): Promise<{ ok: true; sentTo: number } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    const agent = project.briefingAgents.find((a) => a.slug === agentSlug);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentSlug}` };

    const recipients = project.teamEmails ?? [];
    if (recipients.length === 0) {
      return { ok: false, error: "No team emails configured for this project." };
    }

    const row = await prisma.briefing.findFirst({
      where: { agentSlug },
      orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
    });
    if (!row?.body) return { ok: false, error: "No briefing to send yet." };

    const subject = `${project.name} — Morning Brief · ${row.date}`;
    const html = renderBriefingEmailHtml(project, {
      title: `${project.name} — Morning Brief`,
      date: row.date,
      markdownBody: row.body,
    });
    const text = row.body;

    // Send TO the project's own email address (self), BCC the team so
    // recipients don't see each other's addresses.
    const prefix = project.agent.gatewayEnvPrefix;
    const selfEmail =
      (prefix ? process.env[`${prefix}_EMAIL_USER`] : undefined) ??
      process.env.EMAIL_USER ??
      recipients[0];

    const { sendProjectEmail } = await import("@/lib/email");
    const result = await sendProjectEmail(project, {
      to: selfEmail,
      bcc: recipients,
      subject,
      html,
      text,
    });

    if (!result.ok) return result;
    return { ok: true, sentTo: recipients.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Return metadata the email-briefing dialog needs — recipients, SMTP
 * configured status, and whether a briefing exists — without exposing any
 * secret values.
 */
export async function getBriefingEmailMeta(
  agentSlug: string,
): Promise<{ recipients: string[]; configured: boolean; hasBriefing: boolean }> {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { recipients: [], configured: false, hasBriefing: false };

    const { isEmailConfigured } = await import("@/lib/email");
    const configured = isEmailConfigured(project);

    const hasBriefing = !!(await prisma.briefing.findFirst({
      where: { agentSlug },
      orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
      select: { agentSlug: true },
    }));

    return {
      recipients: project.teamEmails ?? [],
      configured,
      hasBriefing,
    };
  } catch {
    return { recipients: [], configured: false, hasBriefing: false };
  }
}
