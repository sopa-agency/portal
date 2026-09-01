import "server-only";

// A leitura de receita on-chain, guardada no banco.
//
// Ver o comentário do model RevenueReadCache no schema para o porquê. Em uma
// frase: leitura de cadeia não pode morar dentro de um render, e a página do
// tesouro passou de 12s para 26s quando passou a morar.

import { prisma } from "@/lib/prisma";
import type { RealizedRevenue } from "@/lib/revenue-onchain";

const keyOf = (address: string, chain: string | null) =>
  `${(chain ?? "all").toLowerCase()}:${address.trim().toLowerCase()}`;

export async function saveRevenueCache(
  address: string,
  chain: string | null,
  r: RealizedRevenue,
): Promise<void> {
  const data = {
    address: address.trim().toLowerCase(),
    chain,
    method: r.method,
    revenueUsd: r.revenueUsd,
    count: r.count,
    series: r.series as unknown as object,
    truncated: r.truncated,
    // A ressalva viaja com o número. Uma linha guardada com zero e sem motivo
    // seria indistinguível de "não houve distribuição" — que é exatamente o bug
    // que este caminho inteiro veio consertar.
    error: r.error ?? null,
    syncedAt: new Date(),
  };
  const key = keyOf(address, chain);
  await prisma.revenueReadCache
    .upsert({ where: { key }, create: { key, ...data }, update: data })
    .catch(() => {});
}

/**
 * A leitura guardada, se ainda vale.
 *
 * `maxAgeMs: Infinity` devolve qualquer idade — usado quando a leitura ao vivo
 * estourou o orçamento e um número velho ANUNCIADO como velho vale mais que um
 * zero mudo.
 *
 * Null é "não tenho", nunca "é zero".
 */
export async function readRevenueCache(
  address: string,
  chain: string | null,
  maxAgeMs: number,
): Promise<RealizedRevenue | null> {
  const row = await prisma.revenueReadCache.findUnique({ where: { key: keyOf(address, chain) } }).catch(() => null);
  if (!row) return null;
  if (Number.isFinite(maxAgeMs) && Date.now() - row.syncedAt.getTime() > maxAgeMs) return null;
  return {
    method: row.method as RealizedRevenue["method"],
    revenueUsd: row.revenueUsd,
    count: row.count,
    series: Array.isArray(row.series) ? (row.series as unknown as { t: string; usd: number }[]) : [],
    truncated: row.truncated,
    ...(row.error ? { error: row.error } : {}),
  };
}
