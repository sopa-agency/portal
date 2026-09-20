import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAccess } from "@/lib/team-access";
import { spendAgentCall, type Bearer } from "@/lib/api-tokens";
import { getAllProjects, getProject } from "@/projects";
import type { ProjectConfig } from "@/projects/types";
import { fetchGitHubProject } from "@/lib/github-project";
import { fetchCostScope } from "@/lib/fixed-costs-data";
import { buildBrainTree, readBrainFile, resolveSafePath, workspaceForProject } from "@/lib/brain-workspace";
import { callOpenClaw } from "@/lib/openclaw-gateway";

// As ferramentas de contexto que um token de membro enxerga, servidas por MCP
// (/api/mcp) e por REST (/api/v1/tools). Tudo aqui é LEITURA, com uma exceção
// declarada: `ask_agent`, que gasta modelo e por isso exige o escopo "agents" e
// tem teto diário por token.
//
// A régua de acesso é a do portal: cada chamada confere `getAccess` da pessoa
// dona do token no projeto pedido. Quem entra na SOPA enxerga também os
// projetos que a SOPA agrega (o portal dela já mostra os três juntos).

export type ToolContext = { bearer: Bearer };

type Tool<S extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Exige o escopo "agents" no token. */
  agents?: boolean;
  handler: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
};

const tool = <S extends z.ZodType>(t: Tool<S>) => t;
const projectArg = z.string().min(1).max(40).describe('Project slug, e.g. "sopa", "gnars", "skatehive". Use list_projects to see yours.');

export class ToolError extends Error {}

/** Os projetos que a pessoa enxerga, com o papel em cada um. */
export async function projectsFor(username: string): Promise<{ project: ProjectConfig; role: string; via?: string }[]> {
  const all = getAllProjects();
  const direct = await Promise.all(all.map(async (project) => ({ project, access: await getAccess(username, project) })));
  const out = new Map<string, { project: ProjectConfig; role: string; via?: string }>();
  for (const { project, access } of direct) if (access.allowed) out.set(project.slug, { project, role: access.role ?? "member" });
  // A SOPA é o agregador: quem está nela lê os projetos que o tesouro dela soma.
  const sopa = out.get("sopa");
  if (sopa) {
    for (const slug of sopa.project.treasury?.includeProjects ?? []) {
      if (out.has(slug)) continue;
      try {
        out.set(slug, { project: getProject(slug), role: "viewer", via: "sopa" });
      } catch {
        /* slug sem projeto registrado */
      }
    }
  }
  return [...out.values()];
}

async function requireProject(ctx: ToolContext, slug: string): Promise<ProjectConfig> {
  const mine = await projectsFor(ctx.bearer.username);
  const hit = mine.find((p) => p.project.slug === slug.trim().toLowerCase());
  if (!hit) throw new ToolError(`No access to project "${slug}". Yours: ${mine.map((p) => p.project.slug).join(", ") || "none"}.`);
  return hit.project;
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}… [+${t.length - n} chars]` : t;
};

function projectSummary(p: ProjectConfig) {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    repos: p.repos,
    socials: p.socials.map((s) => ({ platform: s.platform, handle: s.handle, url: s.url, summary: s.summary })),
    agent: { id: p.agent.id, name: p.agent.displayName },
    hive: { account: p.hive.account, community: p.hive.community },
    farcasterChannel: p.farcaster.channel,
    kanban: p.githubProject ? `github.com/orgs/${p.githubProject.org}/projects/${p.githubProject.number}` : null,
    modules: { postCreator: !!p.postCreator, films: !!p.films, magazine: !!p.magazine, treasury: true, analytics: !!p.analytics },
  };
}

// O que a API lê do workspace do agente: documentos (notas, playbooks, memória).
// Fica de fora a fiação do próprio agente (persona, instruções, ferramentas) e
// tudo que não é documento — config e código podem carregar segredo, e contexto
// de projeto não mora ali.
const BRAIN_READABLE = /\.(md|mdx|txt|csv|ics)$/i;
const BRAIN_HIDDEN_ROOT = new Set(["soul.md", "identity.md", "user.md", "agents.md", "tools.md", "heartbeat.md", "bootstrap.md"]);
const brainVisible = (rel: string) => BRAIN_READABLE.test(rel) && !(!rel.includes("/") && BRAIN_HIDDEN_ROOT.has(rel.toLowerCase()));

// Cinto e suspensório: documento não deveria carregar credencial, mas o que sai
// por token passa por aqui antes. Hash de transação (hex de 64) fica — só cai
// quando a própria linha fala em chave/segredo.
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|rk)[-_][A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bsopa_pat_[A-Za-z0-9_-]{20,}/g,
];
const SECRET_WORDS = /(private[ _-]?key|secret|mnemonic|seed phrase|senha|password|api[ _-]?key|bearer|token)/i;
function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_SHAPES) out = out.replace(re, "[redacted]");
  return out
    .split("\n")
    .map((line) => (SECRET_WORDS.test(line) ? line.replace(/\b(?:0x)?[0-9a-fA-F]{64}\b/g, "[redacted]").replace(/([:=]\s*["'`]?)[A-Za-z0-9_\-./+]{24,}/g, "$1[redacted]") : line))
    .join("\n");
}

export const TOOLS = [
  tool({
    name: "whoami",
    title: "Who am I",
    description: "The portal member this token belongs to, the projects they can read and their role in each.",
    input: z.object({}),
    handler: async (ctx) => {
      const mine = await projectsFor(ctx.bearer.username);
      return { username: ctx.bearer.username, scopes: ctx.bearer.scopes, projects: mine.map((p) => ({ slug: p.project.slug, name: p.project.name, role: p.role, ...(p.via ? { via: p.via } : {}) })) };
    },
  }),
  tool({
    name: "list_projects",
    title: "List projects",
    description: "SOPA and the projects it runs that you can read: what each one is, its repos, social channels, agent and kanban board.",
    input: z.object({}),
    handler: async (ctx) => (await projectsFor(ctx.bearer.username)).map((p) => projectSummary(p.project)),
  }),
  tool({
    name: "get_briefing",
    title: "Latest briefing",
    description: "The most recent daily briefing written by the project's agents (what happened, next actions). Returns the date: an old briefing is history, not today's agenda.",
    input: z.object({ project: projectArg, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date; default = latest") }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const slugs = (p.briefingAgents ?? []).map((b) => b.slug);
      if (!slugs.length) return { project: p.slug, briefing: null, note: "This project has no briefing agent." };
      const rows = await prisma.briefing.findMany({ where: { agentSlug: { in: slugs }, ...(a.date ? { date: a.date } : {}) }, orderBy: [{ date: "desc" }, { generatedAt: "desc" }], take: slugs.length });
      if (!rows.length) return { project: p.slug, briefing: null, note: "No briefing generated yet." };
      const latest = rows[0].date;
      return rows.filter((r) => r.date === latest).map((r) => ({ project: p.slug, agent: r.agentSlug, date: r.date, ageDays: Math.floor((Date.now() - new Date(r.date).getTime()) / 86_400_000), language: r.language, body: r.body }));
    },
  }),
  tool({
    name: "get_kanban",
    title: "Kanban cards",
    description: "Cards on the project's GitHub board: title, column, assignees, labels, fire priority (1-5), deadline, owner. Filter by status column, assignee or text. Bodies are clipped; use get_card for one card in full.",
    input: z.object({
      project: projectArg,
      status: z.string().max(40).optional().describe('Column name contains, e.g. "Ready", "In Progress", "Done"'),
      assignee: z.string().max(40).optional().describe("GitHub login"),
      query: z.string().max(80).optional().describe("Text in title or body"),
      includeDone: z.boolean().optional().describe("Default false"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      if (!p.githubProject) return { project: p.slug, cards: [], note: "This project has no GitHub board configured." };
      const board = await fetchGitHubProject(p);
      if (!board.ok) throw new ToolError("Could not read the GitHub board right now (that does not mean it is empty).");
      const meta = await prisma.cardPriority.findMany({ where: { itemId: { in: board.columns.flatMap((c) => c.items.map((i) => i.id)) } } }).catch(() => []);
      const metaBy = new Map(meta.map((m) => [m.itemId, m]));
      const q = a.query?.toLowerCase();
      const cards = board.columns.flatMap((col) =>
        col.items
          .filter(() => a.includeDone || !/done|conclu|feito/i.test(col.name))
          .filter(() => !a.status || col.name.toLowerCase().includes(a.status.toLowerCase()))
          .filter((i) => !a.assignee || i.assignees.some((x) => x.login.toLowerCase() === a.assignee!.toLowerCase()))
          .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.body ?? "").toLowerCase().includes(q))
          .map((i) => {
            const m = metaBy.get(i.id);
            return { id: i.id, title: i.title, status: col.name, type: i.type, url: i.url ?? null, assignees: i.assignees.map((x) => x.login), labels: i.labels.map((l) => l.name), fire: m?.priority ?? null, deadline: m?.deadline ? m.deadline.toISOString().slice(0, 10) : null, owner: m?.owner ?? null, updatedAt: i.updatedAt ?? null, body: clip(i.body, 400) };
          }),
      );
      cards.sort((x, y) => (y.fire ?? 0) - (x.fire ?? 0));
      return { project: p.slug, columns: board.columns.map((c) => ({ name: c.name, count: c.items.length })), total: cards.length, cards: cards.slice(0, a.limit ?? 40) };
    },
  }),
  tool({
    name: "get_card",
    title: "One kanban card",
    description: "A single kanban card with its full body. `id` is the item id returned by get_kanban.",
    input: z.object({ project: projectArg, id: z.string().min(4).max(80) }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      if (!p.githubProject) throw new ToolError("This project has no GitHub board configured.");
      const board = await fetchGitHubProject(p);
      if (!board.ok) throw new ToolError("Could not read the GitHub board right now.");
      for (const col of board.columns) {
        const i = col.items.find((x) => x.id === a.id);
        if (i) return { id: i.id, title: i.title, status: col.name, type: i.type, url: i.url ?? null, assignees: i.assignees.map((x) => x.login), labels: i.labels.map((l) => l.name), createdAt: i.createdAt ?? null, updatedAt: i.updatedAt ?? null, body: i.body ?? "" };
      }
      throw new ToolError("Card not found on this board.");
    },
  }),
  tool({
    name: "get_treasury",
    title: "Treasury balances",
    description: "Wallet balances of the project's treasury as last synced (hourly): total USD per wallet, top tokens, when it was read. On-chain addresses are public.",
    input: z.object({ project: projectArg }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const rows = await prisma.treasuryBalanceCache.findMany({ where: { projectSlug: p.slug }, orderBy: { totalUsd: "desc" } });
      type Tok = { symbol?: string; valueUsd?: number; balance?: number; chain?: string; note?: string; untrusted?: boolean; hostileLabel?: boolean };
      return {
        project: p.slug,
        totalUsd: Math.round(rows.reduce((s, r) => s + r.totalUsd, 0) * 100) / 100,
        wallets: rows.map((r) => ({
          label: r.label,
          address: r.address,
          totalUsd: Math.round(r.totalUsd * 100) / 100,
          unverifiedUsd: Math.round(r.unverifiedUsd * 100) / 100,
          source: r.source,
          syncedAt: r.syncedAt.toISOString(),
          failedChains: r.failedChains,
          topTokens: ((r.tokens as Tok[] | null) ?? [])
            .filter((t) => (t.valueUsd ?? 0) > 1 && !t.untrusted && !t.hostileLabel)
            .sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0))
            .slice(0, 8)
            .map((t) => ({ symbol: t.symbol, chain: t.chain, balance: t.balance, usd: Math.round((t.valueUsd ?? 0) * 100) / 100, ...(t.note ? { note: t.note } : {}) })),
        })),
      };
    },
  }),
  tool({
    name: "get_costs",
    title: "Fixed costs",
    description: "The project's recurring costs from the portal's cost sheet: label, amount, cadence, monthly USD, whether it is active, notes. Amounts are internal team information.",
    input: z.object({ project: projectArg, includeInactive: z.boolean().optional() }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const scope = await fetchCostScope([p.slug]);
      const rows = (scope.bySlug[p.slug] ?? []).filter((c) => a.includeInactive || c.active);
      return {
        project: p.slug,
        usdBrl: scope.usdBrl,
        monthlyUsd: Math.round(rows.filter((c) => c.active).reduce((s, c) => s + (c.monthlyUsd ?? c.estimateUsd ?? 0), 0) * 100) / 100,
        costs: rows.map((c) => ({ label: c.label, amount: c.amount, currency: c.currency, cadence: c.cadence, category: c.category, active: c.active, variable: c.variable, monthlyUsd: Math.round((c.monthlyUsd ?? c.estimateUsd ?? 0) * 100) / 100, notes: clip(c.notes, 500) })),
      };
    },
  }),
  tool({
    name: "get_team",
    title: "Team",
    description: "Members of the project with their role. For SOPA it also returns the payout weights currently in force on the team split (the result of the weekly vote).",
    input: z.object({ project: projectArg }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const members = await prisma.teamMember.findMany({ where: { projectSlug: { in: [p.slug, "*"] } }, orderBy: { username: "asc" } });
      const payout = p.slug === "sopa" ? await prisma.splitPayoutRound.findFirst({ where: { projectSlug: "sopa" }, orderBy: { appliedAt: "desc" }, include: { shares: true } }) : null;
      const total = payout ? Number(payout.totalAllocation) || 1 : 1;
      return {
        project: p.slug,
        members: members.map((m) => ({ username: m.username, role: m.role, scope: m.projectSlug === "*" ? "global" : "project" })),
        ...(payout ? { payoutWeights: { round: payout.roundLabel, appliedAt: payout.appliedAt.toISOString(), txHash: payout.txHash, shares: payout.shares.map((s) => ({ username: s.username, address: s.address, share: Math.round((Number(s.allocation) / total) * 1000) / 10 })).sort((x, y) => y.share - x.share) } } : {}),
      };
    },
  }),
  tool({
    name: "list_campaigns",
    title: "Campaigns",
    description: "Marketing campaigns of the project: how many documents each has, how many were posted, what is scheduled. Use get_campaign to read the brief and the texts.",
    input: z.object({ project: projectArg, includeArchived: z.boolean().optional() }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const rows = await prisma.campaign.findMany({ where: { projectSlug: p.slug, ...(a.includeArchived ? {} : { archivedAt: null }) }, orderBy: { updatedAt: "desc" }, take: 40, include: { documents: { select: { name: true, isMain: true, postedAt: true, scheduledFor: true } } } });
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        updatedAt: c.updatedAt.toISOString(),
        archived: !!c.archivedAt,
        documents: c.documents.length,
        posted: c.documents.filter((d) => d.postedAt).length,
        scheduled: c.documents.filter((d) => !d.postedAt && d.scheduledFor).map((d) => ({ name: d.name, at: d.scheduledFor!.toISOString() })).slice(0, 12),
      }));
    },
  }),
  tool({
    name: "get_campaign",
    title: "One campaign",
    description: "A campaign's brief and every document text (tweets, casts, posts).",
    input: z.object({ project: projectArg, id: z.string().min(4).max(60) }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const c = await prisma.campaign.findUnique({ where: { id: a.id }, include: { documents: { orderBy: [{ isMain: "desc" }, { createdAt: "asc" }] } } });
      if (!c || c.projectSlug !== p.slug) throw new ToolError("Campaign not found in this project.");
      return { id: c.id, name: c.name, project: c.projectSlug, documents: c.documents.map((d) => ({ name: d.name, main: d.isMain, postedUrl: d.postedUrl ?? null, content: clip(d.content, 6000) })) };
    },
  }),
  tool({
    name: "list_brain_files",
    title: "Agent brain files",
    description: "Documents in the project agent's workspace (its memory, playbooks, notes — text files only). Without arguments: the pinned and core files plus each folder with its file count and a sample. Pass `folder` to list one folder in full, or `query` to search paths. Paths come ready for read_brain_file.",
    input: z.object({
      project: projectArg,
      folder: z.string().max(200).optional().describe("Folder (or folder/subfolder) to list in full"),
      query: z.string().max(80).optional().describe("Only paths containing this text"),
    }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const raw = await buildBrainTree(workspaceForProject(p));
      const tree = { pinned: raw.pinned.filter(brainVisible), core: raw.core.filter(brainVisible), folders: Object.fromEntries(Object.entries(raw.folders).map(([name, files]) => [name, files.filter((f) => brainVisible(`${name}/${f}`))] as const).filter(([, files]) => files.length > 0)) };
      const q = a.query?.trim().toLowerCase();
      const hit = (f: string) => !q || f.toLowerCase().includes(q);
      const MAX = 300;
      const clipped = (all: string[]) => ({ total: all.length, files: all.slice(0, MAX), ...(all.length > MAX ? { note: `Clipped to ${MAX}: narrow it with query or a subfolder.` } : {}) });
      const folder = a.folder?.replace(/^\/+|\/+$/g, "");
      if (folder) {
        const top = folder.split("/")[0];
        const files = tree.folders[top];
        if (!files) throw new ToolError(`No folder "${top}". Folders: ${Object.keys(tree.folders).join(", ") || "none"}.`);
        const sub = folder.slice(top.length + 1);
        return { project: p.slug, folder, ...clipped(files.filter((f) => (!sub || f.startsWith(`${sub}/`)) && hit(f)).map((f) => `${top}/${f}`)) };
      }
      if (q) {
        const all = [...tree.pinned, ...tree.core, ...Object.entries(tree.folders).flatMap(([name, files]) => files.map((f) => `${name}/${f}`))].filter(hit);
        return { project: p.slug, query: a.query, ...clipped(all) };
      }
      return {
        project: p.slug,
        agent: p.agent.displayName,
        pinned: tree.pinned,
        core: tree.core,
        folders: Object.entries(tree.folders).map(([name, files]) => ({ name, files: files.length, sample: files.slice(0, 8).map((f) => `${name}/${f}`) })),
      };
    },
  }),
  tool({
    name: "read_brain_file",
    title: "Read a brain file",
    description: "One file from the project agent's workspace, as text. Large files are clipped.",
    input: z.object({ project: projectArg, path: z.string().min(1).max(300) }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const rel = a.path.replace(/^\/+/, "");
      if (!brainVisible(rel)) throw new ToolError("Not readable through the API: only the agent's documents (.md, .txt, .csv, .ics) are, and its own wiring files are left out.");
      const abs = resolveSafePath(workspaceForProject(p), rel);
      if (!abs) throw new ToolError("Invalid path.");
      const file = await readBrainFile(abs);
      if ("content" in file && typeof file.content === "string") return { project: p.slug, path: rel, content: clip(redactSecrets(file.content), 30_000) };
      return { project: p.slug, path: rel, file };
    },
  }),
  tool({
    name: "ask_agent",
    title: "Ask the project's agent",
    description: "Ask the project's OpenClaw agent a question and get its answer. Spends model budget: needs a token with the 'agents' scope and is capped per day. Takes 1-3 minutes. Prefer the read tools when the answer is in the data.",
    agents: true,
    input: z.object({ project: projectArg, question: z.string().min(8).max(2000) }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const spent = await spendAgentCall(ctx.bearer.tokenId);
      if (!spent.ok) throw new ToolError(spent.error);
      const answer = await callOpenClaw(`Pergunta de @${ctx.bearer.username}, membro do time, via API do portal. Responda direto, com o que você sabe do projeto; diga quando não souber.\n\n${a.question}`, p.agent.id, { timeoutMs: 240_000, project: p, sessionSuffix: `api-${ctx.bearer.username}` });
      return { project: p.slug, agent: p.agent.displayName, answer, agentCallsLeftToday: spent.left };
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export function visibleTools(bearer: Bearer) {
  return TOOLS.filter((t) => !("agents" in t && t.agents) || bearer.scopes.includes("agents"));
}

export function describeTools(bearer: Bearer) {
  return visibleTools(bearer).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: z.toJSONSchema(t.input) }));
}

/** Roda uma ferramenta. Erro de uso volta como ToolError; o resto estoura. */
export async function callTool(bearer: Bearer, name: string, rawArgs: unknown): Promise<unknown> {
  const t = visibleTools(bearer).find((x) => x.name === name);
  if (!t) throw new ToolError(`Unknown tool "${name}".`);
  const parsed = t.input.safeParse(rawArgs ?? {});
  if (!parsed.success) throw new ToolError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  return (t.handler as (c: ToolContext, a: unknown) => Promise<unknown>)({ bearer }, parsed.data);
}
