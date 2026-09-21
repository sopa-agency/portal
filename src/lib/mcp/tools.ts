import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAccess } from "@/lib/team-access";
import { AGENT_CALLS_PER_DAY, spendAgentCall, type Bearer } from "@/lib/api-tokens";
import { getAllProjects, getProject } from "@/projects";
import type { ProjectConfig } from "@/projects/types";
import { addDraftIssue, fetchGitHubProject, mirrorFireToGithub, resolveGitHubToken, setItemStatus } from "@/lib/github-project";
import { fetchCostScope } from "@/lib/fixed-costs-data";
import { buildBrainTree, readBrainFile, resolveSafePath, workspaceForProject } from "@/lib/brain-workspace";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { fetchDevActivity, type Change } from "@/lib/dev-activity";
import { checkAndStore } from "@/lib/draft-check";
import { EXAMPLES, PROMPTS, TOOL_GROUPS, type Lang, type ToolGroupId } from "@/lib/mcp/guide";

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
  /** Família da ferramenta: ordena o guia e a aba do portal. */
  group: ToolGroupId;
  input: S;
  /** Exige o escopo "agents" no token. */
  agents?: boolean;
  /** Grava alguma coisa: exige o escopo "write" no token. */
  write?: boolean;
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

/**
 * Os projetos que ESTE TOKEN enxerga: os da pessoa, cortados pelo limite do
 * token quando ele tem um. O limite só tira — nunca dá acesso que a pessoa não tem.
 */
export async function projectsForBearer(bearer: Bearer): ReturnType<typeof projectsFor> {
  const mine = await projectsFor(bearer.username);
  return bearer.projects?.length ? mine.filter((p) => bearer.projects.includes(p.project.slug)) : mine;
}

async function requireProject(ctx: ToolContext, slug: string): Promise<ProjectConfig> {
  const mine = await projectsForBearer(ctx.bearer);
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

// --- Quadro (kanban) --------------------------------------------------------
// O board do GitHub é lido sem cache pelo portal. Aqui um agente faz várias
// chamadas seguidas sobre o mesmo quadro (visão geral, minhas tarefas, busca),
// então a leitura fica 60 s na memória da instância.

type Card = { id: string; title: string; status: string; done: boolean; type: string; url: string | null; assignees: string[]; labels: string[]; fire: number | null; deadline: string | null; owner: string | null; createdAt: string | null; updatedAt: string | null; body: string };
type Board = { columns: { name: string; count: number }[]; cards: Card[] };

const BOARD_TTL_MS = 60_000;
const boardCache = new Map<string, { at: number; board: Board }>();
const isDoneColumn = (name: string) => /done|conclu|feito/i.test(name);

/** Nulo = projeto sem board. Falha de leitura estoura: vazio e "não li" são coisas diferentes. */
async function loadBoard(p: ProjectConfig): Promise<Board | null> {
  if (!p.githubProject) return null;
  const cached = boardCache.get(p.slug);
  if (cached && Date.now() - cached.at < BOARD_TTL_MS) return cached.board;
  const res = await fetchGitHubProject(p);
  if (!res.ok) throw new ToolError(`Could not read the ${p.name} GitHub board right now (that does not mean it is empty).`);
  const meta = await prisma.cardPriority.findMany({ where: { itemId: { in: res.columns.flatMap((c) => c.items.map((i) => i.id)) } } }).catch(() => []);
  const metaBy = new Map(meta.map((m) => [m.itemId, m]));
  const board: Board = {
    columns: res.columns.map((c) => ({ name: c.name, count: c.items.length })),
    cards: res.columns.flatMap((col) =>
      col.items.map((i) => {
        const m = metaBy.get(i.id);
        return { id: i.id, title: i.title, status: col.name, done: isDoneColumn(col.name), type: i.type, url: i.url ?? null, assignees: i.assignees.map((x) => x.login), labels: i.labels.map((l) => l.name), fire: m?.priority ?? null, deadline: m?.deadline ? m.deadline.toISOString().slice(0, 10) : null, owner: m?.owner ?? null, createdAt: i.createdAt ?? null, updatedAt: i.updatedAt ?? null, body: i.body ?? "" };
      }),
    ),
  };
  boardCache.set(p.slug, { at: Date.now(), board });
  return board;
}

/** Mais fogo primeiro; no empate, o prazo mais próximo. */
const byUrgency = (x: Card, y: Card) => (y.fire ?? 0) - (x.fire ?? 0) || (x.deadline ?? "9999").localeCompare(y.deadline ?? "9999");
const cardLine = (c: Card) => ({ id: c.id, title: c.title, status: c.status, type: c.type, url: c.url, assignees: c.assignees, labels: c.labels, fire: c.fire, deadline: c.deadline, owner: c.owner, updatedAt: c.updatedAt, body: clip(c.body, 400) });
const cardBrief = (c: Card) => ({ id: c.id, title: c.title, status: c.status, fire: c.fire, deadline: c.deadline, assignees: c.assignees, owner: c.owner });
const today = () => new Date().toISOString().slice(0, 10);

/** Como a pessoa aparece nos boards: os logins de GitHub dela e os nomes no portal. */
async function identitiesFor(username: string): Promise<{ logins: Set<string>; names: Set<string>; hasGithub: boolean }> {
  const u = username.toLowerCase();
  const [contacts, aliases] = await Promise.all([
    prisma.teamMemberContact.findMany({ where: { username: { equals: u, mode: "insensitive" }, label: "GitHub" }, select: { value: true } }).catch(() => []),
    prisma.memberAlias.findMany({ where: { username: u }, select: { alias: true } }).catch(() => []),
  ]);
  const login = (v: string) => v.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "").toLowerCase();
  const logins = new Set(contacts.map((c) => login(c.value)).filter(Boolean));
  return { logins, names: new Set([u, ...aliases.map((a) => a.alias.toLowerCase())]), hasGithub: logins.size > 0 };
}

/** Trecho em volta do termo achado, para a busca mostrar por que bateu. */
function snippet(text: string | null | undefined, q: string, around = 110): string {
  const t = (text ?? "").replace(/\s+/g, " ");
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return clip(t, around * 2);
  const from = Math.max(0, i - around);
  return `${from > 0 ? "…" : ""}${t.slice(from, i + q.length + around)}${i + q.length + around < t.length ? "…" : ""}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function treasuryTotal(slug: string): Promise<{ totalUsd: number; syncedAt: string | null }> {
  const rows = await prisma.treasuryBalanceCache.findMany({ where: { projectSlug: slug }, select: { totalUsd: true, syncedAt: true } });
  return { totalUsd: round2(rows.reduce((s, r) => s + r.totalUsd, 0)), syncedAt: rows.length ? new Date(Math.min(...rows.map((r) => r.syncedAt.getTime()))).toISOString() : null };
}

async function monthlyCostUsd(slug: string): Promise<number> {
  const scope = await fetchCostScope([slug]);
  return round2((scope.bySlug[slug] ?? []).filter((c) => c.active).reduce((s, c) => s + (c.monthlyUsd ?? c.estimateUsd ?? 0), 0));
}

/** Seguidores por rede: a leitura mais nova contra a mais antiga dentro da janela. */
async function socialGrowth(slug: string, days: number): Promise<{ platform: string; followers: number; asOf: string; before: number; beforeAt: string; change: number; changePct: number | null }[]> {
  const rows = await prisma.socialMetricSnapshot.findMany({ where: { projectSlug: slug, capturedAt: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { capturedAt: "asc" }, select: { platform: true, followers: true, capturedAt: true } });
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.platform, [...(by.get(r.platform) ?? []), r]);
  return [...by.entries()]
    .map(([platform, list]) => {
      const first = list[0];
      const last = list[list.length - 1];
      const change = last.followers - first.followers;
      return { platform, followers: last.followers, asOf: last.capturedAt.toISOString().slice(0, 10), before: first.followers, beforeAt: first.capturedAt.toISOString().slice(0, 10), change, changePct: first.followers > 0 ? Math.round((change / first.followers) * 1000) / 10 : null };
    })
    .sort((x, y) => y.followers - x.followers);
}

/** Reuniões do projeto: as marcadas no portal dele e as que são SOBRE ele. */
const meetingScope = (slug: string) => ({ OR: [{ projectSlug: slug }, { forProject: slug }] });

type ActionItem = { id?: string; text?: string; project?: string; owner?: string | null; priority?: number; deadline?: string | null; done?: boolean };
const actionItems = (raw: unknown) => (Array.isArray(raw) ? (raw as ActionItem[]) : []).map((i) => ({ text: i.text ?? "", project: i.project || null, owner: i.owner ?? null, priority: i.priority || null, deadline: i.deadline ?? null, done: !!i.done }));

/** Cada parte da visão geral falha sozinha: uma fonte fora do ar não derruba o retrato. */
async function part<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 160) : "unavailable" };
  }
}

// --- O que mudou ---------------------------------------------------------------
// Código (GitHub), board e conteúdo publicado, dentro de uma janela de dias. A
// versão "compacta" é a que entra no retrato do projeto e no consolidado.

const slim = (c: Change) => ({ title: c.title, repo: c.repo, ...(c.branch ? { branch: c.branch, merged: false } : {}), pr: c.pr, by: c.by, at: c.at.slice(0, 10), url: c.url, ...(c.summary ? { summary: c.summary } : {}) });

async function codeChanges(p: ProjectConfig, days: number) {
  if (!p.repos?.length) return { note: "This project declares no GitHub repositories in the portal config." };
  const d = await fetchDevActivity(p, days);
  return {
    since: d.since.slice(0, 10),
    repos: d.repos.map((r) => ({ ...r, lastCommitAt: r.lastCommitAt?.slice(0, 10) ?? null, lastPushAt: r.lastPushAt?.slice(0, 10) ?? null, activeBranches: r.activeBranches.map((b) => ({ ...b, lastCommitAt: b.lastCommitAt.slice(0, 10) })) })),
    totals: { commitsOnDefaultBranch: d.repos.reduce((s, r) => s + r.commits, 0), commitsOnOtherBranches: d.repos.reduce((s, r) => s + r.activeBranches.reduce((n, b) => n + b.commits, 0), 0), mergedPullRequests: d.repos.reduce((s, r) => s + r.mergedPrs, 0), features: d.features.length, fixes: d.fixes.length, other: d.other.length, openPullRequests: d.openPullRequests.length },
    features: d.features.slice(0, 15).map(slim),
    fixes: d.fixes.slice(0, 10).map(slim),
    other: d.other.slice(0, 8).map((c) => ({ title: c.title, repo: c.repo, at: c.at.slice(0, 10) })),
    openPullRequests: d.openPullRequests.slice(0, 10).map((o) => ({ ...o, updatedAt: o.updatedAt.slice(0, 10) })),
    releases: d.releases.map((r) => ({ ...r, at: r.at.slice(0, 10) })),
    // Repositório que não deu para ler NÃO é repositório sem mudança.
    ...(d.unreadable.length ? { unreadable: d.unreadable } : {}),
  };
}

/** A versão de poucas linhas, para o retrato e para o consolidado de vários projetos. */
async function codePulse(p: ProjectConfig, days: number) {
  if (!p.repos?.length) return null;
  const d = await fetchDevActivity(p, days);
  return {
    since: d.since.slice(0, 10),
    commits: d.repos.reduce((s, r) => s + r.commits, 0),
    // Commits na janela que ainda estão fora do branch padrão (repositório que desenvolve em outro branch).
    commitsOnOtherBranches: d.repos.reduce((s, r) => s + r.activeBranches.reduce((n, b) => n + b.commits, 0), 0),
    mergedPullRequests: d.repos.reduce((s, r) => s + r.mergedPrs, 0),
    openPullRequests: d.openPullRequests.length,
    lastCommitAt: d.repos.map((r) => r.lastCommitAt).filter(Boolean).sort().pop()?.slice(0, 10) ?? null,
    lastPushAt: d.repos.map((r) => r.lastPushAt).filter(Boolean).sort().pop()?.slice(0, 10) ?? null,
    // Branch mexido na janela e ainda fora do padrão: o que está sendo feito e não entrou.
    workInProgress: d.repos.flatMap((r) => r.activeBranches.map((b) => ({ repo: r.repo, branch: b.name, commits: b.commits, at: b.lastCommitAt.slice(0, 10), lastCommit: b.lastCommit, by: b.by }))).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 5),
    latestFeatures: d.features.slice(0, 5).map((c) => ({ title: c.title, repo: c.repo, at: c.at.slice(0, 10), ...(c.branch ? { branch: c.branch } : {}) })),
    latestFixes: d.fixes.slice(0, 3).map((c) => ({ title: c.title, repo: c.repo, at: c.at.slice(0, 10), ...(c.branch ? { branch: c.branch } : {}) })),
    releases: d.releases.slice(0, 3).map((r) => ({ repo: r.repo, tag: r.tag, at: r.at.slice(0, 10) })),
    ...(d.unreadable.length ? { unreadable: d.unreadable.map((u) => u.repo) } : {}),
  };
}

async function boardChanges(p: ProjectConfig, days: number) {
  const b = await loadBoard(p);
  if (!b) return { note: "No GitHub board configured." };
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const finished = b.cards.filter((c) => c.done && (c.updatedAt ?? "") >= since).sort((x, y) => (y.updatedAt ?? "").localeCompare(x.updatedAt ?? ""));
  const created = b.cards.filter((c) => (c.createdAt ?? "") >= since).sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? ""));
  return { finished: finished.slice(0, 12).map((c) => ({ id: c.id, title: c.title, at: (c.updatedAt ?? "").slice(0, 10), assignees: c.assignees })), finishedCount: finished.length, created: created.slice(0, 12).map((c) => ({ id: c.id, title: c.title, status: c.status, at: (c.createdAt ?? "").slice(0, 10) })), createdCount: created.length };
}

async function contentChanges(p: ProjectConfig, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const posted = await prisma.campaignDocument.findMany({ where: { campaign: { projectSlug: p.slug }, postedAt: { gte: since } }, orderBy: { postedAt: "desc" }, take: 12, select: { name: true, postedAt: true, postedTo: true, postedUrl: true, campaign: { select: { id: true, name: true } } } });
  return posted.map((d) => ({ campaign: d.campaign.name, document: d.name, at: d.postedAt!.toISOString().slice(0, 10), to: d.postedTo ?? null, url: d.postedUrl ?? null }));
}

// --- Escrita ------------------------------------------------------------------

/** Escrever exige acesso DIRETO ao projeto: ler "via sopa" não dá caneta. */
async function requireWritableProject(ctx: ToolContext, slug: string): Promise<ProjectConfig> {
  const mine = await projectsForBearer(ctx.bearer);
  const hit = mine.find((p) => p.project.slug === slug.trim().toLowerCase());
  if (!hit) throw new ToolError(`No access to project "${slug}". Yours: ${mine.map((p) => p.project.slug).join(", ") || "none"}.`);
  if (hit.via) throw new ToolError(`You read ${hit.project.name} through ${hit.via}, which does not allow writing. Ask to be added to ${hit.project.name} itself.`);
  return hit.project;
}

/** O board cru, sem cache, mais o token do GitHub: escrita parte do estado de agora. */
async function boardForWrite(p: ProjectConfig) {
  if (!p.githubProject) throw new ToolError("This project has no GitHub board configured.");
  const token = resolveGitHubToken(p);
  if (!token) throw new ToolError("The portal has no GitHub token for this board.");
  const board = await fetchGitHubProject(p);
  if (!board.ok) throw new ToolError(`Could not read the ${p.name} GitHub board right now.`);
  return { board, token };
}

/** A coluna pedida pelo nome: exata primeiro, depois "contém", e nunca ambígua. */
function columnNamed(board: Extract<Awaited<ReturnType<typeof fetchGitHubProject>>, { ok: true }>, name: string) {
  const real = board.columns.filter((c) => c.optionId);
  const want = name.trim().toLowerCase();
  const exact = real.filter((c) => c.name.toLowerCase() === want);
  const hits = exact.length ? exact : real.filter((c) => c.name.toLowerCase().includes(want));
  if (hits.length !== 1) throw new ToolError(`${hits.length ? "More than one column matches" : "No column matches"} "${name}". Columns: ${real.map((c) => c.name).join(", ")}.`);
  return hits[0];
}

/** O card tem de estar no board DESTE projeto: id solto não escreve em lugar nenhum. */
async function cardOnBoard(p: ProjectConfig, id: string): Promise<Card> {
  const board = await loadBoard(p);
  if (!board) throw new ToolError("This project has no GitHub board configured.");
  const card = board.cards.find((c) => c.id === id);
  if (!card) throw new ToolError("Card not found on this board.");
  return card;
}

/** Toda escrita por token fica registrada: quem, por qual token, o quê, onde. */
async function logWrite(ctx: ToolContext, tool: string, projectSlug: string, target: string, summary: string) {
  await prisma.apiWriteLog.create({ data: { username: ctx.bearer.username, tokenId: ctx.bearer.tokenId, tool, projectSlug, target, summary: summary.slice(0, 300) } }).catch(() => {});
}

export const TOOLS = [
  tool({
    name: "whoami",
    group: "start",
    title: "Who am I",
    description: "The portal member this token belongs to, the projects they can read and their role in each.",
    input: z.object({}),
    handler: async (ctx) => {
      const mine = await projectsForBearer(ctx.bearer);
      return { username: ctx.bearer.username, scopes: ctx.bearer.scopes, ...(ctx.bearer.projects?.length ? { limitedTo: ctx.bearer.projects } : {}), projects: mine.map((p) => ({ slug: p.project.slug, name: p.project.name, role: p.role, ...(p.via ? { via: p.via } : {}) })) };
    },
  }),
  tool({
    name: "list_projects",
    group: "start",
    title: "List projects",
    description: "SOPA and the projects it runs that you can read: what each one is, its repos, social channels, agent and kanban board.",
    input: z.object({}),
    handler: async (ctx) => (await projectsForBearer(ctx.bearer)).map((p) => projectSummary(p.project)),
  }),
  tool({
    name: "get_guide",
    group: "start",
    title: "What you can ask",
    description: "The menu of this server for the person connected: their projects, the tools by family, ready-made requests and the prompt shortcuts. Call it when they ask what you can do here, or before the first SOPA question of a conversation.",
    input: z.object({ lang: z.enum(["pt", "en"]).optional().describe("Language of the examples; default pt") }),
    handler: async (ctx, a) => guideFor(ctx.bearer, a.lang ?? "pt"),
  }),
  tool({
    name: "get_overview",
    group: "project",
    title: "Project snapshot",
    description: "The state of one project in a single call: board (column counts, hottest and overdue cards), money (treasury, monthly cost, runway), development (last 7 days of code: commits, merged pull requests, latest features and fixes, open pull requests; for SOPA also the same pulse for every project it runs), campaigns in flight, last meeting with minutes, social followers, team size and how old the briefing is. Start here for \"how is <project> doing\"; drill down with the specific tools.",
    input: z.object({ project: projectArg }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const [board, money, briefing, campaigns, meeting, social, team, development, acrossProjects] = await Promise.all([
        part(async () => {
          const b = await loadBoard(p);
          if (!b) return { note: "No GitHub board configured." };
          const open = b.cards.filter((c) => !c.done);
          return { columns: b.columns, open: open.length, hottest: [...open].sort(byUrgency).slice(0, 8).map(cardBrief), overdue: open.filter((c) => c.deadline && c.deadline < today()).sort(byUrgency).slice(0, 8).map(cardBrief), unassigned: open.filter((c) => !c.assignees.length && !c.owner).length };
        }),
        part(async () => {
          const [t, monthly] = await Promise.all([treasuryTotal(p.slug), monthlyCostUsd(p.slug)]);
          // Runway só quando a planilha de custos dá conta do projeto: tesouro de DAO
          // dividido por uma linha de US$ 5 vira um número que parece informação.
          const runway = monthly > 0 ? Math.round((t.totalUsd / monthly) * 10) / 10 : null;
          const sane = runway !== null && runway <= 120;
          return { treasuryUsd: t.totalUsd, treasurySyncedAt: t.syncedAt, monthlyCostUsd: monthly, runwayMonths: sane ? runway : null, ...(sane ? {} : { runwayNote: "No meaningful runway: the cost sheet for this project is empty or far smaller than the treasury (a DAO treasury is not operating cash)." }) };
        }),
        part(async () => {
          const slugs = (p.briefingAgents ?? []).map((b) => b.slug);
          if (!slugs.length) return { note: "No briefing agent." };
          const r = await prisma.briefing.findFirst({ where: { agentSlug: { in: slugs } }, orderBy: [{ date: "desc" }, { generatedAt: "desc" }] });
          return r ? { date: r.date, ageDays: Math.floor((Date.now() - new Date(r.date).getTime()) / 86_400_000), agent: r.agentSlug, excerpt: clip(r.body, 1_200) } : { note: "No briefing generated yet." };
        }),
        part(async () => {
          const rows = await prisma.campaign.findMany({ where: { projectSlug: p.slug, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 6, include: { documents: { select: { postedAt: true, scheduledFor: true } } } });
          return rows.map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt.toISOString().slice(0, 10), documents: c.documents.length, posted: c.documents.filter((d) => d.postedAt).length, scheduled: c.documents.filter((d) => !d.postedAt && d.scheduledFor).length }));
        }),
        part(async () => {
          const m = await prisma.meeting.findFirst({ where: { ...meetingScope(p.slug), summary: { not: null } }, orderBy: { startsAt: "desc" } });
          const o = await prisma.meetingOccurrence.findFirst({ where: { meeting: meetingScope(p.slug), summary: { not: null } }, orderBy: { occurredOn: "desc" }, include: { meeting: { select: { title: true } } } });
          const last = o && (!m || o.occurredOn > m.startsAt) ? { id: o.id, title: o.meeting.title, date: o.occurredOn.toISOString().slice(0, 10), items: actionItems(o.actionItems) } : m ? { id: m.id, title: m.title, date: m.startsAt.toISOString().slice(0, 10), items: actionItems(m.actionItems) } : null;
          return last ? { id: last.id, title: last.title, date: last.date, openActionItems: last.items.filter((i) => !i.done).length } : { note: "No meeting with minutes yet." };
        }),
        part(async () => (await socialGrowth(p.slug, 30)).map((r) => ({ platform: r.platform, followers: r.followers, change30d: r.change }))),
        part(async () => ({ members: await prisma.teamMember.count({ where: { projectSlug: p.slug } }) })),
        part(async () => (await codePulse(p, 7)) ?? { note: "No GitHub repositories declared for this project." }),
        // A SOPA toca todos os projetos: o retrato dela traz o pulso do código de cada um.
        part(async () => {
          if (p.slug !== "sopa") return null;
          const others = (await projectsForBearer(ctx.bearer)).map((x) => x.project).filter((x) => x.slug !== "sopa" && x.repos?.length);
          return Promise.all(others.map(async (x) => ({ project: x.slug, ...((await part(() => codePulse(x, 7))) ?? {}) })));
        }),
      ]);
      return { project: projectSummary(p), asOf: new Date().toISOString(), board, money, development, ...(acrossProjects ? { developmentAcrossProjects: acrossProjects } : {}), briefing, campaigns, lastMeeting: meeting, social, team };
    },
  }),
  tool({
    name: "get_recent_changes",
    group: "project",
    title: "What changed recently",
    description: "What changed in the last N days (default 7). Code from GitHub: features and fixes (taken from merged pull requests, with a short summary of each), commits pushed without a PR, open pull requests, releases, and a per-repository pulse with the branches being worked on that have not reached the default branch yet (a quiet default branch does not mean a quiet repository: compare lastCommitAt with lastPushAt). A change that carries `branch` is not on the default branch yet. Plus the board (cards finished and created) and content that was published. With `project` you get the detail; without it, a compact roll-up of every project you can read, which is the view SOPA needs. A repository listed under `unreadable` could not be read: that is not the same as no changes.",
    input: z.object({ project: projectArg.optional(), days: z.number().int().min(1).max(60).optional() }),
    handler: async (ctx, a) => {
      const days = a.days ?? 7;
      if (a.project) {
        const p = await requireProject(ctx, a.project);
        const [code, board, published] = await Promise.all([part(() => codeChanges(p, days)), part(() => boardChanges(p, days)), part(() => contentChanges(p, days))]);
        return { project: p.slug, days, asOf: new Date().toISOString(), code, board, published };
      }
      const mine = (await projectsForBearer(ctx.bearer)).map((x) => x.project);
      const rows = await Promise.all(
        mine.map(async (p) => {
          const [code, board, published] = await Promise.all([part(() => codePulse(p, days)), part(async () => { const b = await boardChanges(p, days); return "note" in b ? null : { finished: b.finishedCount, created: b.createdCount, latestFinished: b.finished.slice(0, 3).map((c) => c.title) }; }), part(async () => (await contentChanges(p, days)).length)]);
          return { project: p.slug, name: p.name, code, board, published };
        }),
      );
      // Primeiro quem mais mexeu; projeto sem repositório nem board vai para o fim.
      const weight = (r: (typeof rows)[number]) => (r.code && !("error" in r.code) ? r.code.commits + r.code.commitsOnOtherBranches + r.code.mergedPullRequests * 3 : -1);
      return { days, asOf: new Date().toISOString(), projects: rows.sort((x, y) => weight(y) - weight(x)), note: "Compact roll-up. Call get_recent_changes with a project for the full list, summaries and links." };
    },
  }),
  tool({
    name: "get_briefing",
    group: "project",
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
    group: "work",
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
      const board = await loadBoard(p);
      if (!board) return { project: p.slug, cards: [], note: "This project has no GitHub board configured." };
      const q = a.query?.toLowerCase();
      const cards = board.cards
        .filter((c) => a.includeDone || !c.done)
        .filter((c) => !a.status || c.status.toLowerCase().includes(a.status.toLowerCase()))
        .filter((c) => !a.assignee || c.assignees.some((x) => x.toLowerCase() === a.assignee!.toLowerCase()))
        .filter((c) => !q || c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q))
        .sort(byUrgency);
      return { project: p.slug, columns: board.columns, total: cards.length, cards: cards.slice(0, a.limit ?? 40).map(cardLine) };
    },
  }),
  tool({
    name: "get_card",
    group: "work",
    title: "One kanban card",
    description: "A single kanban card with its full body and the notes the team left on it in the portal. `id` is the item id returned by get_kanban, my_tasks or search.",
    input: z.object({ project: projectArg, id: z.string().min(4).max(80) }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const board = await loadBoard(p);
      if (!board) throw new ToolError("This project has no GitHub board configured.");
      const c = board.cards.find((x) => x.id === a.id);
      if (!c) throw new ToolError("Card not found on this board.");
      const notes = await prisma.cardNote.findMany({ where: { cardKey: c.id }, orderBy: { createdAt: "asc" }, take: 40 }).catch(() => []);
      return { ...c, body: clip(c.body, 12_000), notes: notes.map((n) => ({ author: n.author, at: n.createdAt.toISOString().slice(0, 10), body: clip(n.body, 1_500) })) };
    },
  }),
  tool({
    name: "my_tasks",
    group: "work",
    title: "What is on me",
    description: "Open cards assigned to the person behind this token across every board they can read (matched by their GitHub login on file and by card owner), most urgent first, plus the open action items from meetings in their name.",
    input: z.object({ includeDone: z.boolean().optional() }),
    handler: async (ctx, a) => {
      const me = await identitiesFor(ctx.bearer.username);
      const mine = (await projectsForBearer(ctx.bearer)).filter((p) => p.project.githubProject);
      const seen = new Set<string>();
      const unreadable: string[] = [];
      const perProject = await Promise.all(
        mine.map(async ({ project }) => {
          const board = await loadBoard(project).catch(() => null);
          if (!board) {
            unreadable.push(project.slug);
            return { project: project.slug, cards: [] as Card[] };
          }
          return { project: project.slug, cards: board.cards.filter((c) => (a.includeDone || !c.done) && (c.assignees.some((x) => me.logins.has(x.toLowerCase()) || me.names.has(x.toLowerCase())) || (c.owner && me.names.has(c.owner.toLowerCase())))) };
        }),
      );
      // Projetos diferentes podem apontar para o mesmo board: cada card entra uma vez.
      const projects = perProject.map((g) => ({ project: g.project, cards: g.cards.filter((c) => !seen.has(c.id) && seen.add(c.id)).sort(byUrgency).map((c) => ({ ...cardLine(c), body: clip(c.body, 160) })) })).filter((g) => g.cards.length);
      // Itens de ação saem da reunião avulsa e de cada ocorrência das semanais.
      const slugs = (await projectsForBearer(ctx.bearer)).map((p) => p.project.slug);
      const [meetings, occurrences] = await Promise.all([
        prisma.meeting.findMany({ where: { projectSlug: { in: slugs } }, orderBy: { startsAt: "desc" }, take: 30, select: { id: true, title: true, startsAt: true, actionItems: true } }).catch(() => []),
        prisma.meetingOccurrence.findMany({ where: { projectSlug: { in: slugs } }, orderBy: { occurredOn: "desc" }, take: 30, select: { id: true, occurredOn: true, actionItems: true, meeting: { select: { title: true } } } }).catch(() => []),
      ]);
      const isMine = (i: { done: boolean; owner: string | null }) => !i.done && !!i.owner && me.names.has(i.owner.toLowerCase());
      const fromMeetings = [
        ...meetings.flatMap((m) => actionItems(m.actionItems).filter(isMine).map((i) => ({ meeting: m.title, meetingId: m.id, date: m.startsAt.toISOString().slice(0, 10), ...i }))),
        ...occurrences.flatMap((o) => actionItems(o.actionItems).filter(isMine).map((i) => ({ meeting: o.meeting.title, meetingId: o.id, date: o.occurredOn.toISOString().slice(0, 10), ...i }))),
      ].sort((x, y) => y.date.localeCompare(x.date));
      return {
        username: ctx.bearer.username,
        matchedBy: { githubLogins: [...me.logins], portalNames: [...me.names] },
        ...(me.hasGithub ? {} : { note: "No GitHub login on file for you, so cards were matched by your portal username only. Add it in the portal: Team → your card → contact labelled GitHub." }),
        total: projects.reduce((s, g) => s + g.cards.length, 0),
        projects,
        actionItemsFromMeetings: fromMeetings.slice(0, 30),
        ...(unreadable.length ? { boardsNotRead: unreadable } : {}),
      };
    },
  }),
  tool({
    name: "list_meetings",
    group: "work",
    title: "Meetings",
    description: "Meetings of the project, newest first: which ones have minutes (the \"ata\") and how many action items are still open. Weekly meetings list each occurrence. Use get_meeting with an id to read the minutes.",
    input: z.object({ project: projectArg, limit: z.number().int().min(1).max(40).optional() }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const rows = await prisma.meeting.findMany({ where: meetingScope(p.slug), orderBy: { startsAt: "desc" }, take: a.limit ?? 15, include: { occurrences: { orderBy: { occurredOn: "desc" }, take: 8 } } });
      return rows.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.startsAt.toISOString().slice(0, 10),
        kind: m.kind,
        weekly: m.weekly,
        about: m.forProject ?? m.projectSlug,
        hasMinutes: !!m.summary,
        openActionItems: actionItems(m.actionItems).filter((i) => !i.done).length,
        occurrences: m.occurrences.map((o) => ({ id: o.id, date: o.occurredOn.toISOString().slice(0, 10), hasMinutes: !!o.summary, openActionItems: actionItems(o.actionItems).filter((i) => !i.done).length })),
      }));
    },
  }),
  tool({
    name: "get_meeting",
    group: "work",
    title: "One meeting",
    description: "The minutes of a meeting (or of one occurrence of a weekly meeting): summary, link to the published minutes and every action item with owner, priority, deadline and whether it is done. The raw transcript is not served.",
    input: z.object({ project: projectArg, id: z.string().min(4).max(60).describe("Meeting id or occurrence id from list_meetings") }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const inScope = (m: { projectSlug: string; forProject: string | null }) => m.projectSlug === p.slug || m.forProject === p.slug;
      const m = await prisma.meeting.findUnique({ where: { id: a.id } });
      if (m) {
        if (!inScope(m)) throw new ToolError("Meeting not found in this project.");
        return { id: m.id, title: m.title, date: m.startsAt.toISOString(), kind: m.kind, weekly: m.weekly, agenda: clip(m.notes, 3_000), minutes: clip(m.summary, 14_000) || null, minutesUrl: m.summaryUrl ?? null, actionItems: actionItems(m.actionItems) };
      }
      const o = await prisma.meetingOccurrence.findUnique({ where: { id: a.id }, include: { meeting: true } });
      if (!o || !inScope(o.meeting)) throw new ToolError("Meeting not found in this project.");
      return { id: o.id, title: o.meeting.title, date: o.occurredOn.toISOString(), kind: o.meeting.kind, weekly: true, minutes: clip(o.summary, 14_000) || null, minutesUrl: o.hackmdUrl ?? null, actionItems: actionItems(o.actionItems) };
    },
  }),
  tool({
    name: "get_treasury",
    group: "money",
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
    group: "money",
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
    group: "money",
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
    group: "content",
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
    group: "content",
    title: "One campaign",
    description: "A campaign's brief and every document text (tweets, casts, posts).",
    input: z.object({ project: projectArg, id: z.string().min(4).max(60) }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const c = await prisma.campaign.findUnique({ where: { id: a.id }, include: { documents: { orderBy: [{ isMain: "desc" }, { createdAt: "asc" }] } } });
      if (!c || c.projectSlug !== p.slug) throw new ToolError("Campaign not found in this project.");
      return { id: c.id, name: c.name, project: c.projectSlug, documents: c.documents.map((d) => ({ name: d.name, main: d.isMain, postedUrl: d.postedUrl ?? null, ...(d.check ? { check: (({ verdict, flags }) => ({ verdict, flags }))(d.check as { verdict: string; flags: string[] }) } : {}), content: clip(d.content, 6000) })) };
    },
  }),
  tool({
    name: "get_social_metrics",
    group: "content",
    title: "Social followers",
    description: "Followers per network for the project, now versus N days ago (default 30): absolute change and percent, with the dates of both readings.",
    input: z.object({ project: projectArg, days: z.number().int().min(1).max(365).optional() }),
    handler: async (ctx, a) => {
      const p = await requireProject(ctx, a.project);
      const rows = await socialGrowth(p.slug, a.days ?? 30);
      return rows.length ? { project: p.slug, days: a.days ?? 30, networks: rows } : { project: p.slug, networks: [], note: "No follower snapshots for this project." };
    },
  }),
  tool({
    name: "search",
    group: "knowledge",
    title: "Search everything",
    description: "Find a term across what the portal knows: kanban cards, campaign texts, briefings, meeting minutes and (when a project is given) the agent's document names. Each hit says which tool opens it in full. Without `project` it searches every project you can read.",
    input: z.object({ query: z.string().min(2).max(80), project: projectArg.optional() }),
    handler: async (ctx, a) => {
      const q = a.query.trim();
      const scope = a.project ? [await requireProject(ctx, a.project)] : (await projectsForBearer(ctx.bearer)).map((x) => x.project);
      const slugs = scope.map((p) => p.slug);
      const has = { contains: q, mode: "insensitive" as const };
      const [kanban, campaigns, briefings, meetings, brainFiles] = await Promise.all([
        part(async () => {
          const seen = new Set<string>();
          const boards = await Promise.all(scope.filter((p) => p.githubProject).map(async (p) => ({ p, board: await loadBoard(p).catch(() => null) })));
          return boards
            .flatMap(({ p, board }) => (board?.cards ?? []).filter((c) => (c.title + " " + c.body).toLowerCase().includes(q.toLowerCase()) && !seen.has(c.id) && seen.add(c.id)).map((c) => ({ c, p })))
            .sort((x, y) => Number(x.c.done) - Number(y.c.done) || byUrgency(x.c, y.c))
            .slice(0, 10)
            .map(({ c, p }) => ({ project: p.slug, title: c.title, status: c.status, fire: c.fire, snippet: snippet(c.title.toLowerCase().includes(q.toLowerCase()) ? c.body || c.title : c.body, q), open: { tool: "get_card", arguments: { project: p.slug, id: c.id } } }));
        }),
        part(async () => {
          const docs = await prisma.campaignDocument.findMany({ where: { campaign: { projectSlug: { in: slugs }, archivedAt: null }, OR: [{ content: has }, { name: has }] }, orderBy: { updatedAt: "desc" }, take: 8, include: { campaign: { select: { id: true, name: true, projectSlug: true } } } });
          return docs.map((d) => ({ project: d.campaign.projectSlug, campaign: d.campaign.name, document: d.name, snippet: snippet(d.content, q), open: { tool: "get_campaign", arguments: { project: d.campaign.projectSlug, id: d.campaign.id } } }));
        }),
        part(async () => {
          const agentToProject = new Map(scope.flatMap((p) => (p.briefingAgents ?? []).map((b) => [b.slug, p.slug] as const)));
          if (!agentToProject.size) return [];
          const rows = await prisma.briefing.findMany({ where: { agentSlug: { in: [...agentToProject.keys()] }, body: has }, orderBy: { date: "desc" }, take: 6 });
          return rows.map((r) => ({ project: agentToProject.get(r.agentSlug) ?? null, date: r.date, snippet: snippet(r.body, q), open: { tool: "get_briefing", arguments: { project: agentToProject.get(r.agentSlug), date: r.date } } }));
        }),
        part(async () => {
          const inScope = { OR: [{ projectSlug: { in: slugs } }, { forProject: { in: slugs } }] };
          const [rows, occ] = await Promise.all([
            prisma.meeting.findMany({ where: { AND: [inScope, { OR: [{ title: has }, { summary: has }, { notes: has }] }] }, orderBy: { startsAt: "desc" }, take: 6 }),
            prisma.meetingOccurrence.findMany({ where: { meeting: inScope, summary: has }, orderBy: { occurredOn: "desc" }, take: 6, include: { meeting: { select: { title: true, projectSlug: true, forProject: true } } } }),
          ]);
          const owner = (m: { projectSlug: string; forProject: string | null }) => (slugs.includes(m.projectSlug) ? m.projectSlug : (m.forProject ?? m.projectSlug));
          return [
            ...rows.map((m) => ({ project: owner(m), title: m.title, date: m.startsAt.toISOString().slice(0, 10), snippet: snippet(m.summary ?? m.notes ?? m.title, q), open: { tool: "get_meeting", arguments: { project: owner(m), id: m.id } } })),
            ...occ.map((o) => ({ project: owner(o.meeting), title: o.meeting.title, date: o.occurredOn.toISOString().slice(0, 10), snippet: snippet(o.summary, q), open: { tool: "get_meeting", arguments: { project: owner(o.meeting), id: o.id } } })),
          ].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 8);
        }),
        part(async () => {
          // O índice de arquivos passa pela fila do agente: só quando o projeto foi dito.
          if (!a.project) return { note: "Pass `project` to also search the agent's document names." };
          const p = scope[0];
          const tree = await buildBrainTree(workspaceForProject(p));
          const all = [...tree.pinned, ...tree.core, ...Object.entries(tree.folders).flatMap(([name, files]) => files.map((f) => `${name}/${f}`))].filter((f) => brainVisible(f) && f.toLowerCase().includes(q.toLowerCase()));
          return all.slice(0, 12).map((path) => ({ project: p.slug, path, open: { tool: "read_brain_file", arguments: { project: p.slug, path } } }));
        }),
      ]);
      return { query: q, searched: slugs, kanban, campaigns, briefings, meetings, brainFiles };
    },
  }),
  tool({
    name: "list_brain_files",
    group: "knowledge",
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
    group: "knowledge",
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
  // --- Escrita ---------------------------------------------------------------
  // Só com o escopo "write", que a pessoa liga por token. Tudo aqui é o que um
  // membro já faz pela tela do portal, pelos mesmos caminhos, e nada apaga nem
  // publica: postar em rede, agendar, mexer em tesouro, pagamento, time ou
  // arquivos dos agentes fica de fora de propósito.
  tool({
    name: "add_card_note",
    group: "write",
    write: true,
    title: "Add a note to a card",
    description: "Leave a note on a kanban card, signed by the person behind this token. Notes live in the portal (not on GitHub) and are what get_card returns under `notes`. Use it to record what you found or did on a task.",
    input: z.object({ project: projectArg, id: z.string().min(4).max(80).describe("Card id from get_kanban, my_tasks or search"), note: z.string().min(2).max(3800) }),
    handler: async (ctx, a) => {
      const p = await requireWritableProject(ctx, a.project);
      const card = await cardOnBoard(p, a.id);
      const row = await prisma.cardNote.create({ data: { projectSlug: p.slug, cardKey: card.id, author: ctx.bearer.username, body: `${a.note.trim()}\n\n_via API_` } });
      await logWrite(ctx, "add_card_note", p.slug, card.id, card.title);
      return { ok: true, project: p.slug, card: { id: card.id, title: card.title }, note: { id: row.id, author: row.author, at: row.createdAt.toISOString() } };
    },
  }),
  tool({
    name: "create_card",
    group: "write",
    write: true,
    title: "Create a kanban card",
    description: "Create a draft card on the project's GitHub board, optionally placing it in a column and setting fire priority (1-5), deadline and owner. The body is signed with who created it. Check search first so you do not duplicate an existing card.",
    input: z.object({
      project: projectArg,
      title: z.string().min(3).max(200),
      body: z.string().max(8000).optional().describe("Markdown"),
      status: z.string().max(40).optional().describe('Column to place it in, e.g. "Ready". Default: the board\'s first column'),
      fire: z.number().int().min(1).max(5).optional(),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      owner: z.string().max(40).optional().describe("Portal username of the owner"),
    }),
    handler: async (ctx, a) => {
      const p = await requireWritableProject(ctx, a.project);
      const { board, token } = await boardForWrite(p);
      const column = a.status ? columnNamed(board, a.status) : null;
      const made = await addDraftIssue({ token, projectId: board.projectId, title: a.title.trim(), body: `${(a.body ?? "").trim()}\n\n_Criado por @${ctx.bearer.username} via API do portal._`.trim() });
      if (!made.ok) throw new ToolError(`GitHub refused the card: ${made.error}`);
      const itemId = made.itemId;
      await prisma.cardPriority.upsert({ where: { itemId }, create: { itemId, projectSlug: p.slug, createdBy: ctx.bearer.username, updatedBy: ctx.bearer.username, priority: a.fire ?? 0, deadline: a.deadline ? new Date(a.deadline) : null, owner: a.owner?.trim().toLowerCase() || null }, update: {} }).catch(() => {});
      if (a.fire) void mirrorFireToGithub({ token, itemId, fire: a.fire }).catch(() => {});
      let placed: string | null = null;
      if (column && board.statusFieldId) {
        const moved = await setItemStatus({ token, projectId: board.projectId, itemId, fieldId: board.statusFieldId, optionId: column.optionId! });
        placed = moved.ok ? column.name : null;
      }
      boardCache.delete(p.slug);
      await logWrite(ctx, "create_card", p.slug, itemId, a.title.trim());
      return { ok: true, project: p.slug, card: { id: itemId, title: a.title.trim(), status: placed, fire: a.fire ?? null, deadline: a.deadline ?? null, owner: a.owner?.trim().toLowerCase() || null }, ...(column && !placed ? { warning: "Card created, but it could not be placed in that column." } : {}) };
    },
  }),
  tool({
    name: "move_card",
    group: "write",
    write: true,
    title: "Move a card to another column",
    description: "Change the status column of a kanban card (for example Ready → In progress → Done). Moving is the team's signal of progress: move only what the person asked you to move.",
    input: z.object({ project: projectArg, id: z.string().min(4).max(80), status: z.string().min(2).max(40).describe("Target column name") }),
    handler: async (ctx, a) => {
      const p = await requireWritableProject(ctx, a.project);
      const { board, token } = await boardForWrite(p);
      if (!board.statusFieldId) throw new ToolError("This board has no Status field.");
      const from = board.columns.find((c) => c.items.some((i) => i.id === a.id));
      const item = from?.items.find((i) => i.id === a.id);
      if (!from || !item) throw new ToolError("Card not found on this board.");
      const to = columnNamed(board, a.status);
      if (to.name === from.name) return { ok: true, project: p.slug, card: { id: item.id, title: item.title }, status: to.name, note: "Already in that column." };
      const moved = await setItemStatus({ token, projectId: board.projectId, itemId: item.id, fieldId: board.statusFieldId, optionId: to.optionId! });
      if (!moved.ok) throw new ToolError(`GitHub refused the move: ${moved.error}`);
      boardCache.delete(p.slug);
      await logWrite(ctx, "move_card", p.slug, item.id, `${item.title}: ${from.name} → ${to.name}`);
      return { ok: true, project: p.slug, card: { id: item.id, title: item.title }, from: from.name, status: to.name };
    },
  }),
  tool({
    name: "update_card",
    group: "write",
    write: true,
    title: "Set fire, deadline or owner",
    description: "Set a card's fire priority (1-5, 0 clears it), deadline (YYYY-MM-DD, empty string clears it) and/or owner (portal username, empty string clears it). Only the fields you pass change.",
    input: z.object({ project: projectArg, id: z.string().min(4).max(80), fire: z.number().int().min(0).max(5).optional(), deadline: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(), owner: z.string().max(40).optional() }),
    handler: async (ctx, a) => {
      const p = await requireWritableProject(ctx, a.project);
      if (a.fire === undefined && a.deadline === undefined && a.owner === undefined) throw new ToolError("Pass at least one of fire, deadline, owner.");
      const card = await cardOnBoard(p, a.id);
      const data = { ...(a.fire !== undefined ? { priority: a.fire } : {}), ...(a.deadline !== undefined ? { deadline: a.deadline ? new Date(a.deadline) : null } : {}), ...(a.owner !== undefined ? { owner: a.owner.trim().toLowerCase() || null } : {}), updatedBy: ctx.bearer.username };
      const row = await prisma.cardPriority.upsert({ where: { itemId: card.id }, create: { itemId: card.id, projectSlug: p.slug, ...data }, update: data });
      const token = resolveGitHubToken(p);
      if (a.fire !== undefined && token) void mirrorFireToGithub({ token, itemId: card.id, fire: a.fire }).catch(() => {});
      boardCache.delete(p.slug);
      await logWrite(ctx, "update_card", p.slug, card.id, `${card.title}: ${Object.keys(data).filter((k) => k !== "updatedBy").join(", ")}`);
      return { ok: true, project: p.slug, card: { id: card.id, title: card.title, fire: row.priority || null, deadline: row.deadline ? row.deadline.toISOString().slice(0, 10) : null, owner: row.owner ?? null } };
    },
  }),
  tool({
    name: "save_campaign_draft",
    group: "write",
    write: true,
    title: "Save a draft into a campaign",
    description: "Save a text (a tweet, a cast, a post) as a NEW document inside an existing campaign, for the team to review in the portal's Campaign Creator. It is only a draft: nothing is posted or scheduled, and existing documents are never changed. Short drafts come back with a `check` against the campaign brief (invented numbers, dates, rewards, hype): if the verdict is review, fix the text and save again.",
    input: z.object({ project: projectArg, campaign: z.string().min(4).max(60).describe("Campaign id from list_campaigns"), name: z.string().min(2).max(80).describe('Document name, e.g. "Tweet 11 — auctions"'), content: z.string().min(2).max(12_000) }),
    handler: async (ctx, a) => {
      const p = await requireWritableProject(ctx, a.project);
      const c = await prisma.campaign.findUnique({ where: { id: a.campaign }, select: { id: true, name: true, projectSlug: true, archivedAt: true } });
      if (!c || c.projectSlug !== p.slug) throw new ToolError("Campaign not found in this project.");
      if (c.archivedAt) throw new ToolError("That campaign is archived.");
      const doc = await prisma.campaignDocument.create({ data: { campaignId: c.id, name: a.name.trim(), content: a.content.trim(), isMain: false }, select: { id: true, name: true } });
      await logWrite(ctx, "save_campaign_draft", p.slug, doc.id, `${c.name} / ${doc.name}`);
      // O rascunho é conferido contra o briefing da campanha; o agente que escreveu já sabe se passou.
      const check = await checkAndStore(doc.id).catch(() => null);
      return {
        ok: true,
        project: p.slug,
        campaign: { id: c.id, name: c.name },
        document: doc,
        ...(check ? { check: { verdict: check.verdict, flags: check.flags, scores: check.scores, meaning: check.verdict === "ok" ? "Faithful to the campaign brief." : `Review before posting: the draft seems to bring ${check.flags.join(", ")} that the brief does not support. Fix it and save a new draft.` } } : {}),
        note: "Saved as a draft. Nothing was posted or scheduled.",
      };
    },
  }),
  tool({
    name: "ask_agent",
    group: "agents",
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

const needsAgents = (t: (typeof TOOLS)[number]) => "agents" in t && !!t.agents;
const needsWrite = (t: (typeof TOOLS)[number]) => "write" in t && !!t.write;
const allowedBy = (scopes: string[]) => (t: (typeof TOOLS)[number]) => (!needsAgents(t) || scopes.includes("agents")) && (!needsWrite(t) || scopes.includes("write"));

export function visibleTools(bearer: Bearer) {
  return TOOLS.filter(allowedBy(bearer.scopes));
}

export type CatalogEntry = { name: string; title: string; description: string; group: ToolGroupId; needsAgents: boolean; needsWrite: boolean };

/** O catálogo em linguagem de gente, para o guia e para a aba do portal. Sem token = tudo. */
export function catalogFor(bearer: Bearer | null): CatalogEntry[] {
  return (bearer ? visibleTools(bearer) : TOOLS).map((t) => ({ name: t.name, title: t.title, description: t.description, group: t.group, needsAgents: needsAgents(t), needsWrite: needsWrite(t) }));
}

export function describeTools(bearer: Bearer) {
  // readOnlyHint deixa o cliente aprovar leitura sem perguntar a cada chamada;
  // ask_agent fica de fora porque gasta modelo e fala com um sistema externo.
  return visibleTools(bearer).map((t) => {
    const spends = needsAgents(t);
    const writes = needsWrite(t);
    return { name: t.name, title: t.title, description: t.description, inputSchema: z.toJSONSchema(t.input), annotations: { title: t.title, readOnlyHint: !spends && !writes, destructiveHint: false, idempotentHint: !spends && !writes, openWorldHint: spends } };
  });
}

/** O cardápio do servidor para quem está conectado. */
export async function guideFor(bearer: Bearer, lang: Lang) {
  const mine = await projectsForBearer(bearer);
  const catalog = catalogFor(bearer);
  const groups = TOOL_GROUPS.map((g) => ({ family: g.label[lang], about: g.hint[lang], tools: catalog.filter((t) => t.group === g.id).map((t) => ({ name: t.name, what: t.description })) })).filter((g) => g.tools.length);
  const open = new Set(catalog.map((t) => t.group));
  return {
    connectedAs: bearer.username,
    scopes: bearer.scopes,
    projects: mine.map((p) => ({ slug: p.project.slug, name: p.project.name, role: p.role, ...(p.via ? { via: p.via } : {}) })),
    startWith: [
      "get_overview with one of the project slugs above: the whole picture of a project in one call.",
      "my_tasks: what is assigned to this person across every board.",
      "search: a topic you cannot place, across cards, campaigns, briefings and meetings.",
      "get_recent_changes: latest features, fixes and pull requests from GitHub, plus what left the board and what was published; without a project, all of them at once.",
    ],
    families: groups,
    thingsToAsk: EXAMPLES.filter((e) => open.has(e.group)).map((e) => e.text[lang]),
    shortcuts: PROMPTS.map((p) => ({ prompt: p.name, what: p.description[lang], arguments: p.args.map((x) => x.name) })),
    rules: [
      bearer.scopes.includes("write") ? "This token can also write (card notes, new cards, moving cards, fire/deadline/owner, campaign drafts). Say what you are about to write and get a yes before calling a write tool; every write is logged under this person's name." : "This token is read-only, scoped to what this person sees in the portal. Writing needs a token created with the write option.",
      "Data carries dates (briefing date, syncedAt, meeting date): say how old it is.",
      "An empty or failed read is not a zero: say you could not read it.",
      "Costs, payout weights and meeting minutes are internal team information.",
      ...(bearer.scopes.includes("agents") ? [`ask_agent spends model budget: at most ${AGENT_CALLS_PER_DAY} a day on this token, and only when the read tools cannot answer.`] : ["This token cannot ask the agents (no `agents` scope): an admin creates one that can."]),
    ],
  };
}

/**
 * O que o cliente entrega ao modelo na conexão (`initialize.instructions`). É o
 * mais perto que o MCP tem de uma mensagem de boas-vindas: o modelo já chega
 * sabendo quem é a pessoa, quais projetos existem e por onde começar.
 */
export async function instructionsFor(bearer: Bearer): Promise<string> {
  const mine = await projectsForBearer(bearer).catch(() => []);
  const projects = mine.map((p) => `${p.project.slug} (${p.project.name}, ${p.role}${p.via ? ` via ${p.via}` : ""})`).join(", ") || "none yet";
  return [
    `You are connected to the SOPA portal as @${bearer.username}. SOPA is a crypto-native dev and marketing agency; this server is the working context of SOPA and the projects it runs, as its team and its OpenClaw agents keep it.`,
    bearer.projects?.length ? `This token is limited to these projects (the person may see more in the portal, this token does not): ${projects}.` : `Projects this person can read: ${projects}.`,
    "How to use it:",
    "- When they ask what you can do here, or on the first SOPA question of a conversation, call get_guide and offer a few concrete options for THEIR projects.",
    "- \"How is <project> doing\" starts with get_overview: one call returns board, money, campaigns, last meeting, social and the briefing date. Drill down with the specific tools after.",
    "- \"What is on me\" is my_tasks. A topic you cannot place is search. Both work without a project.",
    "- \"What changed\", \"what shipped\", \"latest features\" is get_recent_changes: code from GitHub (features and fixes out of merged pull requests), the board and published content. Without a project it rolls up every project, which is the SOPA-wide view.",
    "- Every other tool takes a project slug from the list above.",
    "- Data carries dates (briefing date, syncedAt, meeting date). Say how old it is: an old briefing is history, not today's agenda. If a tool returns nothing or fails, say so instead of filling the gap.",
    ...(bearer.scopes.includes("write") ? ["- This token can WRITE: add_card_note, create_card, move_card, update_card, save_campaign_draft. Tell the person what you are about to write and get a yes first; search before creating a card so you do not duplicate one. Every write is logged under their name. Nothing here posts, schedules, deletes or moves money."] : []),
    bearer.scopes.includes("agents") ? `- Everything else is read-only except ask_agent, which spends model budget (${AGENT_CALLS_PER_DAY} a day on this token): use it only when the read tools cannot answer.` : "- Reads only, apart from the write tools if listed above. This token cannot ask the agents.",
    "- Costs, payout weights and meeting minutes are internal team information: use them to help this person, not to publish.",
    "- Answer in the person's language; the team mostly writes in Portuguese.",
  ].join("\n");
}

/**
 * O catálogo como OpenAPI 3.1, para harness que não fala MCP mas importa uma
 * especificação (ações de GPT, n8n, toolkits de OpenAPI). É o espelho REST: uma
 * operação POST por ferramenta, com o mesmo JSON Schema de entrada.
 */
export function openApiFor(origin: string, scopes: string[]) {
  const tools = TOOLS.filter(allowedBy(scopes));
  const schemaOf = (t: (typeof TOOLS)[number]) => {
    const schema = { ...(z.toJSONSchema(t.input) as Record<string, unknown>) };
    delete schema.$schema;
    return schema;
  };
  const reply = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, result: {}, error: { type: "string" } }, required: ["ok"] } } } });
  return {
    openapi: "3.1.0",
    info: { title: "SOPA Portal API", version: "1.1.0", description: "Context about SOPA and the projects it runs: project snapshots, kanban, tasks, meetings, treasury, costs, campaigns and the agents' documents. Every call is scoped to what the token's owner can see in the portal. Reads are the default; the write operations exist only for tokens created with the write scope. Start with get_guide." },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Personal token from the portal: Settings → API & MCP." } } },
    paths: Object.fromEntries(
      tools.map((t) => [
        `/api/v1/tools/${t.name}`,
        { post: { operationId: t.name, summary: t.title, description: t.description, tags: [t.group], requestBody: { required: false, content: { "application/json": { schema: schemaOf(t) } } }, responses: { "200": reply("The tool result."), "400": reply("Bad arguments, unknown tool or no access to the project."), "401": reply("Missing or invalid token.") } } },
      ]),
    ),
  };
}

/** Leitura pura (nem grava, nem gasta modelo): as únicas que o REST aceita por GET. */
export function isReadTool(name: string): boolean {
  const t = TOOLS.find((x) => x.name === name);
  return !!t && !needsAgents(t) && !needsWrite(t);
}

/** Converte a query string nos tipos que o schema da ferramenta espera. */
export function argsFromQuery(name: string, params: URLSearchParams): Record<string, unknown> {
  const t = TOOLS.find((x) => x.name === name);
  const props = (t ? (z.toJSONSchema(t.input) as { properties?: Record<string, { type?: string }> }).properties : undefined) ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) {
    const type = props[k]?.type;
    out[k] = type === "boolean" ? v === "true" || v === "1" : type === "number" || type === "integer" ? Number(v) : v;
  }
  return out;
}

/** Roda uma ferramenta. Erro de uso volta como ToolError; o resto estoura. */
export async function callTool(bearer: Bearer, name: string, rawArgs: unknown): Promise<unknown> {
  const t = visibleTools(bearer).find((x) => x.name === name);
  if (!t) throw new ToolError(`Unknown tool "${name}".`);
  const parsed = t.input.safeParse(rawArgs ?? {});
  if (!parsed.success) throw new ToolError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  return (t.handler as (c: ToolContext, a: unknown) => Promise<unknown>)({ bearer }, parsed.data);
}
