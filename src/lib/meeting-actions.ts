import "server-only";
import { prisma } from "@/lib/prisma";
import { getAllProjects } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Meeting action items — the bridge between a meeting's summary and the Kanban.
// Stored as JSON on Meeting.actionItems. Each item optionally spawns ONE GitHub
// Project card (tracked by cardItemId) so re-running "Criar cards" never
// duplicates and the loop can close (done ⇐ the card is closed on the board).
// ---------------------------------------------------------------------------

export type MeetingActionItem = {
  /** Stable id (used for React keys, idempotent card creation, toggling done). */
  id: string;
  /** The action, one line. */
  text: string;
  /** Target project slug (a board owner: skatehive | gnars | vlad …) or "" if unassigned. */
  project: string;
  /** Portal username of the owner (lowercased), or null. */
  owner: string | null;
  /** Fire-priority 1 (low) .. 5 (high); 0 = unset. */
  priority: number;
  /** Due date yyyy-mm-dd, or null. */
  deadline: string | null;
  /** Manually-toggled or card-closed completion. */
  done: boolean;
  /** GitHub Project item node id once a card exists (null = no card yet). */
  cardItemId: string | null;
  /** Human URL of the spawned card, when it's a real issue (drafts have none). */
  cardUrl: string | null;
};

/** Coerce whatever is in the JSON column into a clean, typed array. */
export function parseActionItems(value: unknown): MeetingActionItem[] {
  if (!Array.isArray(value)) return [];
  const out: MeetingActionItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    const p = Math.round(Number(r.priority));
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : cheapId(text, out.length),
      text: text.slice(0, 500),
      project: typeof r.project === "string" ? r.project.trim().toLowerCase() : "",
      owner: typeof r.owner === "string" && r.owner.trim() ? r.owner.trim().toLowerCase() : null,
      priority: !p || p < 1 || p > 5 ? 0 : p,
      deadline: typeof r.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) ? r.deadline : null,
      done: r.done === true,
      cardItemId: typeof r.cardItemId === "string" && r.cardItemId ? r.cardItemId : null,
      cardUrl: typeof r.cardUrl === "string" && r.cardUrl ? r.cardUrl : null,
    });
  }
  return out;
}

/** Deterministic id from text + index (no Math.random — stable across renders). */
function cheapId(text: string, i: number): string {
  let h = 0;
  for (let c = 0; c < text.length; c++) h = (h * 31 + text.charCodeAt(c)) | 0;
  return `ai_${(h >>> 0).toString(36)}_${i}`;
}

/** Projects that own a real GitHub Project board (valid card targets). */
export function boardProjects(): ProjectConfig[] {
  return getAllProjects().filter((p) => !!p.githubProject);
}

/**
 * Map a portal username → GitHub login using the team's "GitHub" contacts.
 * Looks ACROSS every portal (a login entered on one portal is valid on all),
 * so an owner assigned in a SOPA meeting resolves even if their GitHub handle
 * was only ever saved on the SkateHive portal.
 */
export async function githubLoginsByUsername(): Promise<Map<string, string>> {
  const rows = await prisma.teamMemberContact
    .findMany({ where: { label: "GitHub" }, select: { username: true, value: true, updatedAt: true } })
    .catch(() => []);
  // Newest write wins if a member has the contact on several portals.
  const sorted = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const map = new Map<string, string>();
  for (const r of sorted) {
    const u = r.username.trim().toLowerCase();
    if (map.has(u)) continue;
    const login = r.value
      .trim()
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
      .replace(/^@/, "")
      .replace(/\/.*$/, "")
      .trim();
    if (login) map.set(u, login);
  }
  return map;
}
