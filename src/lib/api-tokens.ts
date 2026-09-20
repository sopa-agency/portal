import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

// Tokens pessoais de API/MCP.
//
// O token é de uma PESSOA, não de um projeto: quem ele é decide o que ele vê, e
// o acesso por projeto é conferido a cada chamada com a mesma régua do portal
// (`getAccess`). Tirar alguém do time tira o alcance do token dela na hora, sem
// ninguém precisar lembrar de revogar nada.
//
// O banco guarda só o sha256. O token aparece UMA vez, na tela em que nasce —
// um vazamento do banco não entrega credencial nenhuma.

export const TOKEN_PREFIX = "sopa_pat_";
export type Scope = "read" | "agents" | "write";

/** Quantas perguntas a agentes um token faz por dia. Agente gasta modelo. */
export const AGENT_CALLS_PER_DAY = 10;
const MAX_TOKENS_PER_USER = 10;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /** Vazio = todos os projetos da pessoa. */
  projects: string[];
  calls: number;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function listTokens(username: string): Promise<TokenRow[]> {
  const rows = await prisma.apiToken.findMany({ where: { username: username.toLowerCase(), revokedAt: null }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, projects: r.projects, calls: r.calls, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null }));
}

/** Nome de quem não escolheu nome: o token nasce pronto, sem formulário. */
export const AUTO_TOKEN_NAME = "Meu agente";
const autoName = () => `${AUTO_TOKEN_NAME} · ${new Date().toISOString().slice(0, 10)}`;

/** Cria o token e devolve o segredo — a única vez em que ele existe em claro. */
export async function createToken(username: string, name: string, scopes: Scope[], projects: string[] = []): Promise<{ ok: true; token: string; row: TokenRow } | { ok: false; error: string }> {
  const u = username.toLowerCase();
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60) || autoName();
  // Token automático que ninguém chegou a usar depois de um dia é aba aberta e
  // fechada sem copiar: sai de cena para não virar pilha. O prazo protege quem
  // configurou um cliente agora e ainda não fez a primeira chamada.
  await prisma.apiToken.updateMany({ where: { username: u, revokedAt: null, calls: 0, name: { startsWith: AUTO_TOKEN_NAME }, createdAt: { lt: new Date(Date.now() - 86_400_000) } }, data: { revokedAt: new Date() } }).catch(() => {});
  const ativos = await prisma.apiToken.count({ where: { username: u, revokedAt: null } });
  if (ativos >= MAX_TOKENS_PER_USER) return { ok: false, error: `Limite de ${MAX_TOKENS_PER_USER} tokens ativos. Revogue um antes de criar outro.` };
  const secret = TOKEN_PREFIX + crypto.randomBytes(30).toString("base64url");
  const row = await prisma.apiToken.create({
    data: { username: u, name: clean, tokenHash: sha256(secret), prefix: secret.slice(0, TOKEN_PREFIX.length + 6), scopes: [...new Set<Scope>(["read", ...scopes])], projects: [...new Set(projects.map((x) => x.trim().toLowerCase()).filter(Boolean))] },
  });
  return { ok: true, token: secret, row: { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes, projects: row.projects, calls: 0, createdAt: row.createdAt.toISOString(), lastUsedAt: null } };
}

export async function revokeToken(username: string, id: string): Promise<boolean> {
  const r = await prisma.apiToken.updateMany({ where: { id, username: username.toLowerCase(), revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count > 0;
}

export type Bearer = { tokenId: string; username: string; scopes: string[]; /** Vazio = sem limite de projeto. */ projects: string[] };

/** Lê `Authorization: Bearer …` e devolve de quem é. Nulo = não autenticado. */
export async function verifyBearer(authorization: string | null): Promise<Bearer | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m || !m[1].startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: sha256(m[1]) } }).catch(() => null);
  if (!row || row.revokedAt) return null;
  // O registro de uso é ESPERADO, e num comando só. Solto ("void …"), a função
  // serverless congelava depois de responder com a transação do Prisma ainda
  // aberta: a linha do token ficava travada por minutos e a conexão, presa.
  // Um UPDATE avulso faz commit sozinho, então não há transação para ficar no ar.
  await prisma.$executeRaw`UPDATE "ApiToken" SET "lastUsedAt" = now(), "calls" = "calls" + 1 WHERE "id" = ${row.id}`.catch(() => {});
  return { tokenId: row.id, username: row.username, scopes: row.scopes, projects: row.projects };
}

/** Gasta uma pergunta a agente do dia. Falso = limite diário atingido. */
export async function spendAgentCall(tokenId: string): Promise<{ ok: true; left: number } | { ok: false; error: string }> {
  const hoje = new Date().toISOString().slice(0, 10);
  const row = await prisma.apiToken.findUnique({ where: { id: tokenId } });
  if (!row) return { ok: false, error: "Token não encontrado." };
  const usados = row.agentCallsDay === hoje ? row.agentCallsCount : 0;
  if (usados >= AGENT_CALLS_PER_DAY) return { ok: false, error: `Limite diário de ${AGENT_CALLS_PER_DAY} perguntas a agentes atingido para este token.` };
  await prisma.apiToken.update({ where: { id: tokenId }, data: { agentCallsDay: hoje, agentCallsCount: usados + 1 } });
  return { ok: true, left: AGENT_CALLS_PER_DAY - usados - 1 };
}
