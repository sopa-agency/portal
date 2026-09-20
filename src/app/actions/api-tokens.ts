"use server";

// Tokens pessoais de API/MCP, do lado de quem está logado: listar os meus,
// criar um (o segredo volta UMA vez) e revogar.

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { getAccess, verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";
import { createToken, listTokens, revokeToken, type Scope, type TokenRow } from "@/lib/api-tokens";

async function me(): Promise<{ ok: true; username: string; admin: boolean } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session?.username) return { ok: false, error: "Unauthorized." };
  const access = await getAccess(session.username, project);
  return { ok: true, username: session.username, admin: access.role === "admin" };
}

export async function myApiTokens(): Promise<{ ok: true; tokens: TokenRow[]; admin: boolean } | { ok: false; error: string }> {
  const m = await me();
  if (!m.ok) return m;
  return { ok: true, tokens: await listTokens(m.username), admin: m.admin };
}

export async function createApiToken(name: string, withAgents: boolean): Promise<{ ok: true; token: string; row: TokenRow } | { ok: false; error: string }> {
  const m = await me();
  if (!m.ok) return m;
  // Perguntar a agente gasta modelo: só quem administra cria token com esse escopo.
  if (withAgents && !m.admin) return { ok: false, error: "Só admins criam token com acesso aos agentes." };
  const scopes: Scope[] = withAgents ? ["agents"] : [];
  return createToken(m.username, name, scopes);
}

export async function revokeApiToken(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await me();
  if (!m.ok) return m;
  return (await revokeToken(m.username, id)) ? { ok: true } : { ok: false, error: "Token não encontrado." };
}
