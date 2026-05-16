import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type BriefingKind =
  | "status"
  | "priorities"
  | "risks"
  | "changes"
  | "actions"
  | "coordination"
  | "sources"
  | "generic";

export type BriefingSection = {
  heading: string;
  kind: BriefingKind;
  body: string;
};

export type BriefingAgent = {
  slug: string;
  label: string;
  workspace: string;
};

export const BRIEFING_AGENTS: BriefingAgent[] = [
  { slug: "skate-dev", label: "SkateHive Dev", workspace: "workspace-skate-dev" },
  {
    slug: "skatehive-marketing",
    label: "SkateHive Marketing",
    workspace: "workspace-skatehive-marketing",
  },
];

export type Briefing = {
  agent: BriefingAgent;
  date: string;
  filePath: string;
  preamble: string;
  sections: BriefingSection[];
};

export type BriefingResult =
  | { ok: true; briefing: Briefing }
  | { ok: false; agent: BriefingAgent; error: string };

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function classify(heading: string): BriefingKind {
  const h = heading
    .replace(/^\d+[.):]\s*/, "")
    .toLowerCase()
    .trim();
  if (/font|source/.test(h)) return "sources";
  if (/risc|risk|bloque|blocker|stale/.test(h)) return "risks";
  if (/mudan|change/.test(h)) return "changes";
  if (/coorden|coordination|alinha/.test(h)) return "coordination";
  if (/aç[aã]o|aç[oõ]es|acao|acoes|next action|recommen|action|próxim|proxim|next/.test(h))
    return "actions";
  if (/priorid|priorit/.test(h)) return "priorities";
  if (/hoje|today|importa/.test(h)) return "status";
  return "generic";
}

function splitSections(markdown: string): { preamble: string; sections: BriefingSection[] } {
  const parts = markdown.split(/(?=^## )/m);
  const preamble = parts.shift()?.trim() ?? "";
  const sections: BriefingSection[] = parts.map((chunk) => {
    const lines = chunk.split("\n");
    const headingLine = lines[0] ?? "";
    const heading = headingLine.replace(/^##\s*/, "").trim();
    const body = lines.slice(1).join("\n").trim();
    return { heading, kind: classify(heading), body };
  });
  return { preamble, sections };
}

export async function loadLatestBriefing(agent: BriefingAgent): Promise<BriefingResult> {
  const dir = path.join(os.homedir(), ".openclaw", agent.workspace, "memory", "episodic");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    return {
      ok: false,
      agent,
      error: `Cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const dated = entries
    .map((name) => {
      const m = DATE_FILE_RE.exec(name);
      return m ? { file: name, date: m[1] } : null;
    })
    .filter((x): x is { file: string; date: string } => x !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = dated[0];
  if (!latest) {
    return { ok: false, agent, error: "No briefing files in episodic memory." };
  }
  const filePath = path.join(dir, latest.file);
  try {
    const content = await fs.readFile(filePath, "utf8");
    const { preamble, sections } = splitSections(content);
    return {
      ok: true,
      briefing: { agent, date: latest.date, filePath, preamble, sections },
    };
  } catch (err) {
    return {
      ok: false,
      agent,
      error: `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function freshnessLabel(briefingDate: string, today: string): {
  label: string;
  tone: "fresh" | "stale" | "warn";
} {
  if (briefingDate === today) return { label: "today", tone: "fresh" };
  const diffDays = Math.round(
    (Date.parse(today) - Date.parse(briefingDate)) / 86_400_000,
  );
  if (diffDays === 1) return { label: "yesterday", tone: "stale" };
  if (diffDays > 1) return { label: `${diffDays}d old`, tone: "warn" };
  return { label: briefingDate, tone: "stale" };
}
