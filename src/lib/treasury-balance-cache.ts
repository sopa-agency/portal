import "server-only";

// A composição das carteiras de tesouro, lida uma vez por hora e guardada.
//
// POR QUE EXISTE
//
// A página lia cada carteira por RPC a cada carregamento. Dois problemas
// medidos, não supostos:
//
//   1. CEGUEIRA. O leitor por RPC só enxerga o que alguém DECLARA no código —
//      native, USDC, e os cofres/tokens listados à mão. Posição de protocolo
//      não mora no ERC-20 da carteira, então some. Foi assim que 200,27 USDC no
//      cofre da SOPA ficaram invisíveis até alguém reparar, e é por isso que o
//      stETH na Morpheus também não aparece.
//
//   2. LENTIDÃO. O estágio do saldo sozinho levava 7,6s por carregamento.
//
// A Zerion resolve os dois: uma requisição cobre todas as redes e ela indexa
// protocolo. O cron horário grava aqui, e a página lê daqui.
//
// O RPC NÃO SAI DE CENA. Ele é o fallback: sem linha fresca, a página faz a
// leitura antiga. Trocar uma fonte por outra sem rede de segurança seria
// apostar o tesouro inteiro na disponibilidade de um terceiro.
//
// E `source` viaja com o número. Saldo sem procedência é a mesma armadilha do
// total sem cobertura: parece exato porque tem vírgula.

import { prisma } from "@/lib/prisma";
import type { EvmToken, EvmWalletReport } from "@/lib/treasury";

/**
 * Quanto tempo uma linha vale.
 *
 * O cron grava de hora em hora; 90 minutos dá folga para uma rodada atrasar sem
 * a página cair no RPC à toa. Passou disso, o dado é velho demais para ser
 * apresentado como saldo e a leitura ao vivo assume.
 */
const TTL_MS = 90 * 60_000;

export type CachedComposition = {
  report: EvmWalletReport;
  source: string;
  syncedAt: Date;
  unverifiedUsd: number;
  unverifiedCount: number;
};

/** Grava a composição de uma carteira. Chamado pelo cron, nunca pela página. */
export async function saveWalletComposition(args: {
  address: string;
  label: string;
  projectSlug: string;
  source: string;
  totalUsd: number;
  tokens: EvmToken[];
  failedChains: string[];
  unpriced?: { symbol: string; balance: number }[];
  unverifiedUsd?: number;
  unverifiedCount?: number;
}): Promise<void> {
  const address = args.address.trim().toLowerCase();
  const data = {
    label: args.label,
    projectSlug: args.projectSlug,
    source: args.source,
    totalUsd: args.totalUsd,
    unverifiedUsd: args.unverifiedUsd ?? 0,
    unverifiedCount: args.unverifiedCount ?? 0,
    tokens: args.tokens as unknown as object,
    failedChains: args.failedChains,
    unpriced: (args.unpriced ?? null) as unknown as object,
    syncedAt: new Date(),
  };
  await prisma.treasuryBalanceCache
    .upsert({ where: { address }, create: { address, ...data }, update: data })
    .catch(() => {});
}

/**
 * A composição guardada, se ainda vale.
 *
 * Devolve null quando não há linha ou quando ela passou do prazo — e null aqui
 * significa "use o caminho antigo", nunca "esta carteira está vazia". Quem
 * chama tem que tratar os dois casos diferente, e é por isso que esta função
 * não devolve um relatório vazio de consolação.
 */
export async function readWalletComposition(address: string): Promise<CachedComposition | null> {
  const key = address.trim().toLowerCase();
  const row = await prisma.treasuryBalanceCache.findUnique({ where: { address: key } }).catch(() => null);
  if (!row) return null;
  if (Date.now() - row.syncedAt.getTime() > TTL_MS) return null;

  const tokens = Array.isArray(row.tokens) ? (row.tokens as unknown as EvmToken[]) : [];
  const unpriced = Array.isArray(row.unpriced)
    ? (row.unpriced as unknown as { symbol: string; balance: number }[])
    : undefined;

  // SEM `as EvmWalletReport`. O cast que estava aqui calou o compilador sobre
  // um campo OBRIGATÓRIO que eu não preenchia: `unpriced`. Sem ele o objeto
  // saía com undefined onde a tela espera lista, e o tesouro da SkateHive
  // sumiu da página em produção. O tipo tinha a resposta o tempo todo; o cast
  // é que mandou ele calar a boca.
  const report: EvmWalletReport = {
    label: row.label,
    address: row.address,
    totalUsd: row.totalUsd,
    tokens,
    failedChains: row.failedChains,
    unpriced: unpriced ?? [],
  };

  return {
    report,
    source: row.source,
    syncedAt: row.syncedAt,
    unverifiedUsd: row.unverifiedUsd,
    unverifiedCount: row.unverifiedCount,
  };
}
