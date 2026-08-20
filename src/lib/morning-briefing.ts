import { prisma } from "@/lib/prisma";

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
  /** Short label for the tab strip. Defaults to `label` if omitted. */
  tabLabel?: string;
  workspace: string;
};

export const BRIEFING_AGENTS: BriefingAgent[] = [
  { slug: "skate-dev", label: "SkateHive Dev", tabLabel: "DEV", workspace: "workspace-skate-dev" },
  {
    slug: "skatehive-marketing",
    label: "SkateHive Marketing",
    tabLabel: "MKT",
    workspace: "workspace-skatehive-marketing",
  },
];

export type Briefing = {
  agent: BriefingAgent;
  date: string;
  preamble: string;
  sections: BriefingSection[];
  /** Raw markdown body as stored in the DB — used for email rendering. */
  rawBody: string;
};

export type BriefingResult =
  | { ok: true; briefing: Briefing }
  | { ok: false; agent: BriefingAgent; error: string };

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
  let row;
  try {
    row = await prisma.briefing.findFirst({
      where: { agentSlug: agent.slug },
      orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
    });
  } catch (err) {
    return {
      ok: false,
      agent,
      error: `DB read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!row) {
    return {
      ok: false,
      agent,
      error: "No briefing yet. Click Regenerate to create one.",
    };
  }
  const { preamble, sections } = splitSections(row.body);
  return {
    ok: true,
    briefing: { agent, date: row.date, preamble, sections, rawBody: row.body },
  };
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
