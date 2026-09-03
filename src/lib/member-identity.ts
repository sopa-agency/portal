import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Uma pessoa, vários logins.
 *
 * O portal sempre tratou `username` como se fosse a pessoa. Não é — é um
 * login. `keepkey`, `highlander22` e `bithighlander22` são o mesmo humano, e
 * o sistema os mostrava como três: três cartões na aba Team, três
 * destinatários possíveis no split, três pessoas para creditar no mérito.
 *
 * Aqui a tradução acontece numa camada só, e o resto do código continua
 * falando em `username`. Quem chama `canonico()` está perguntando "de quem é
 * este login?"; quem chama `identidades()` está perguntando "por onde esta
 * pessoa entra?".
 *
 * ── Por que o acesso é a UNIÃO ──────────────────────────────────────────────
 * `highlander22` é admin global e `keepkey` não é. Se apelidar rebaixasse a
 * pessoa ao acesso do canônico, dizer "estes dois são a mesma pessoa" tiraria
 * privilégio de alguém — o que é uma mudança de segurança disfarçada de
 * arrumação de cadastro. A união preserva o que a pessoa já tinha, e é a
 * leitura honesta: ela JÁ entrava como admin, por um login que já era dela.
 */

/** Cache por requisição não serve aqui: o mapa muda raramente e é lido muito. */
let _mapa: Map<string, string> | null = null;
let _validoAte = 0;
const TTL_MS = 60_000;

async function mapa(): Promise<Map<string, string>> {
  if (_mapa && Date.now() < _validoAte) return _mapa;
  const linhas = await prisma.memberAlias.findMany({ select: { alias: true, username: true } }).catch(() => null);
  // Leitura que falhou NÃO vira mapa vazio guardado: um mapa vazio em cache
  // desfaz todos os apelidos por um minuto, e desfazer apelido é justamente o
  // que separa uma pessoa em três de novo. Sem cache, tenta na próxima.
  if (!linhas) return _mapa ?? new Map();
  _mapa = new Map(linhas.map((l) => [l.alias.toLowerCase(), l.username.toLowerCase()]));
  _validoAte = Date.now() + TTL_MS;
  return _mapa;
}

/** O nome canônico de um login. Devolve ele mesmo quando não há apelido. */
export async function canonico(login: string): Promise<string> {
  const u = login.trim().toLowerCase();
  return (await mapa()).get(u) ?? u;
}

/** Todos os logins de uma pessoa, incluindo o canônico. Sempre ≥ 1. */
export async function identidades(login: string): Promise<string[]> {
  const m = await mapa();
  const c = m.get(login.trim().toLowerCase()) ?? login.trim().toLowerCase();
  const todos = new Set([c]);
  for (const [alias, canon] of m) if (canon === c) todos.add(alias);
  return [...todos];
}

/** O mapa inteiro, para telas que precisam agrupar em lote (a aba Team). */
export async function todosOsApelidos(): Promise<Map<string, string>> {
  return new Map(await mapa());
}

/** Zera o cache — chamar depois de escrever um apelido. */
export function esquecerApelidos(): void {
  _mapa = null;
  _validoAte = 0;
}
