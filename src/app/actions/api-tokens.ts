"use server";

// Tokens pessoais de API/MCP, do lado de quem está logado: listar os meus,
// criar um (o segredo volta UMA vez) e revogar.

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { getAccess, verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";
import { createToken, listTokens, revokeToken, type Scope, type TokenRow } from "@/lib/api-tokens";
import { catalogFor, openApiFor, projectsFor, type CatalogEntry } from "@/lib/mcp/tools";

async function me(): Promise<{ ok: true; username: string; admin: boolean } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session?.username) return { ok: false, error: "Unauthorized." };
  const access = await getAccess(session.username, project);
  return { ok: true, username: session.username, admin: access.role === "admin" };
}

export type MyProject = { slug: string; name: string };

/**
 * Os tokens de quem está logado. Com `issueFirst`, quem ainda não tem nenhum
 * já recebe o seu: a pessoa abre a aba e os comandos vêm preenchidos, sem
 * formulário. `fresh` é o segredo desse token — a única vez em que ele volta.
 */
export async function myApiTokens(issueFirst = false): Promise<{ ok: true; tokens: TokenRow[]; admin: boolean; fresh: string | null; projects: MyProject[] } | { ok: false; error: string }> {
  const m = await me();
  if (!m.ok) return m;
  // Os projetos da pessoa, para ela poder limitar um token a alguns deles.
  const projects = (await projectsFor(m.username)).map((p) => ({ slug: p.project.slug, name: p.project.name }));
  const tokens = await listTokens(m.username);
  if (issueFirst && tokens.length === 0) {
    const made = await createToken(m.username, "", []);
    if (made.ok) return { ok: true, tokens: [made.row], admin: m.admin, fresh: made.token, projects };
  }
  return { ok: true, tokens, admin: m.admin, fresh: null, projects };
}

export async function createApiToken(name: string, withAgents: boolean, withWrite = false, limitTo: string[] = []): Promise<{ ok: true; token: string; row: TokenRow } | { ok: false; error: string }> {
  const m = await me();
  if (!m.ok) return m;
  // Perguntar a agente gasta modelo: só quem administra cria token com esse escopo.
  if (withAgents && !m.admin) return { ok: false, error: "Só admins criam token com acesso aos agentes." };
  // Escrever é o que qualquer membro já faz pela tela: a pessoa liga por token,
  // e cada ferramenta confere o acesso dela ao projeto na hora de gravar.
  const scopes: Scope[] = [...(withAgents ? (["agents"] as const) : []), ...(withWrite ? (["write"] as const) : [])];
  // O limite só pode citar projeto que a pessoa enxerga. Ele corta acesso, nunca
  // dá: na hora da chamada vale a interseção com o que ela ainda tem.
  const mine = new Set((await projectsFor(m.username)).map((p) => p.project.slug));
  const projects = [...new Set(limitTo.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const alheio = projects.filter((x) => !mine.has(x));
  if (alheio.length) return { ok: false, error: `Você não tem acesso a: ${alheio.join(", ")}.` };
  return createToken(m.username, name, scopes, projects);
}

export type ApiWrite = { id: string; tool: string; projectSlug: string; summary: string; at: string };

/** As últimas escritas feitas pelos tokens de quem está logado. */
export async function myApiWrites(): Promise<ApiWrite[]> {
  const m = await me();
  if (!m.ok) return [];
  const rows = await prisma.apiWriteLog.findMany({ where: { username: m.username.toLowerCase() }, orderBy: { createdAt: "desc" }, take: 12 }).catch(() => []);
  return rows.map((r) => ({ id: r.id, tool: r.tool, projectSlug: r.projectSlug, summary: r.summary, at: r.createdAt.toISOString() }));
}

export async function revokeApiToken(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await me();
  if (!m.ok) return m;
  return (await revokeToken(m.username, id)) ? { ok: true } : { ok: false, error: "Token não encontrado." };
}

/** O catálogo de ferramentas como o servidor o serve, para a aba nunca divergir dele. */
export async function apiCatalog(): Promise<CatalogEntry[]> {
  const m = await me();
  return m.ok ? catalogFor(null) : [];
}

/** A especificação OpenAPI do espelho REST, para o botão de copiar da aba. */
export async function apiOpenApi(origin: string): Promise<string | null> {
  const m = await me();
  if (!m.ok || !/^https?:\/\/[a-z0-9.:-]+$/i.test(origin)) return null;
  return JSON.stringify(openApiFor(origin, ["read", "write", ...(m.admin ? ["agents"] : [])]), null, 2);
}
