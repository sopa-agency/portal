import "server-only";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Human feedback on AI insights / morning briefings.
//
// A team member can leave free-text corrections on any insight or briefing
// panel ("the lowest-performing post was made 50min ago — don't treat it as an
// underperformer"). Notes are grouped by `scope` and injected into that panel's
// prompt on the NEXT generation, so the output self-corrects over time.
// ---------------------------------------------------------------------------

export type FeedbackKind = "analytics" | "social" | "briefing";

export type FeedbackNote = {
  id: string;
  note: string;
  createdAt: string;
  createdBy: string | null;
};

/**
 * Canonical scope key for a feedback target.
 *  - analytics → `analytics:<projectSlug>`
 *  - social    → `social:<projectSlug>:<platform>`
 *  - briefing  → `briefing:<agentSlug>`  (briefings are per agent, not per project)
 */
export function feedbackScope(kind: FeedbackKind, projectSlug: string, key?: string): string {
  if (kind === "briefing") return `briefing:${(key ?? "").toLowerCase()}`;
  if (kind === "social") return `social:${projectSlug}:${(key ?? "").toLowerCase()}`;
  return `analytics:${projectSlug}`;
}

export async function getFeedbackNotes(scope: string): Promise<FeedbackNote[]> {
  const rows = await prisma.insightFeedback.findMany({
    where: { scope },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, note: true, createdAt: true, createdBy: true },
  });
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
  }));
}

/**
 * Markdown block of the team's corrections, ready to append to a generation
 * prompt. Returns "" when there's no feedback (so callers can append blindly).
 */
export async function feedbackPromptBlock(scope: string): Promise<string> {
  const notes = await getFeedbackNotes(scope);
  if (notes.length === 0) return "";
  // Oldest → newest so the agent reads them in the order they were given.
  const ordered = [...notes].reverse();
  const lines = ordered.map((n, i) => `${i + 1}. ${n.note.trim()}`);
  return [
    "=== Team corrections to honor ===",
    "The team left the following corrections on PAST versions of this output. Treat them as binding instructions and apply every one. If a correction conflicts with the raw data, follow the data but address the nuance the correction raised.",
    ...lines,
  ].join("\n");
}
