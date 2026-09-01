import "server-only";

// O resultado do botão "sincronizar" do gráfico de tesouro, guardado.
//
// Ele vivia só no estado do cliente. Sincronizar, dar F5 e ver tudo voltar ao
// começo não é só irritante: cada sync é uma requisição por carteira na Zerion,
// então clicar de novo toda visita gasta cota por um dado que já tinha sido
// buscado minutos antes.
//
// Aqui não há TTL. O que está guardado é o que a pessoa PEDIU explicitamente, e
// some-lo por idade recriaria o problema original. O gráfico já carrega a data
// da sincronização — dado velho que se anuncia é uma leitura de antes, não uma
// mentira.

import { prisma } from "@/lib/prisma";
import type { TreasurySeries } from "@/lib/treasury-history";

export function chartCacheKey(scope: string, period: string): string {
  return `${scope}|${period}`;
}

export async function saveChartSync(
  key: string,
  series: TreasurySeries[],
  failed: string[],
): Promise<void> {
  const data = { series: series as unknown as object, failed, syncedAt: new Date() };
  await prisma.treasuryChartCache
    .upsert({ where: { key }, create: { key, ...data }, update: data })
    .catch(() => {});
}

/** O último sync guardado, ou null. Null significa "nunca sincronizaram", que a
 *  tela já sabe mostrar — nunca um gráfico vazio com cara de tesouro zerado. */
/**
 * O último sync deste ESCOPO, seja qual for o período.
 *
 * Antes a página procurava a chave exata `escopo|3months`. Quem sincronizou
 * olhando outro período recarregava e não achava nada — e do lado de cá parecia
 * que o sync não tinha sido guardado, quando o que faltava era procurar direito.
 */
export async function readChartSync(
  scope: string,
): Promise<{ series: TreasurySeries[]; failed: string[]; syncedAt: Date } | null> {
  const row = await prisma.treasuryChartCache
    .findFirst({ where: { key: { startsWith: `${scope}|` } }, orderBy: { syncedAt: "desc" } })
    .catch(() => null);
  if (!row) return null;
  const series = Array.isArray(row.series) ? (row.series as unknown as TreasurySeries[]) : [];
  if (!series.length) return null;
  return { series, failed: row.failed, syncedAt: row.syncedAt };
}
