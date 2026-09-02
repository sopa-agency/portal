import "server-only";
import { prisma } from "@/lib/prisma";
import { saveWalletComposition } from "@/lib/treasury-balance-cache";
import { getAllProjects } from "@/projects/index";
import { fetchAddressBalance, fetchEvmWallet, getPrices, hiveAccountBalances, readDeclaredCapital, type ExtraToken, type EvmToken } from "@/lib/treasury";

// Fotografa o saldo de cada carteira de tesouro configurada, de hora em hora.
//
// Uma requisição POR CARTEIRA, não por carteira × rede: fetchAddressBalance sem
// chain usa o caminho Zerion, que devolve todas as redes de uma vez. Com ~5
// carteiras isso é ~5 requisições por hora — e passa a enxergar redes que o
// fan-out por RPC nem conhece (a gnosis, por exemplo, onde o Safe da SOPA tem
// posição).

const EVERY_MS = 60 * 60 * 1000;

/** Contas Hive únicas por nome. Mesma regra das carteiras: uma conta listada
 *  em dois portais é UMA leitura. */
export function treasuryHiveAccounts(): { projectSlug: string; label: string; account: string }[] {
  const seen = new Map<string, { projectSlug: string; label: string; account: string }>();
  for (const p of getAllProjects()) {
    for (const a of p.treasury?.hiveAccounts ?? []) {
      const key = a.account.trim().replace(/^@/, "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, { projectSlug: p.slug, label: a.label, account: key });
    }
  }
  return [...seen.values()];
}

/** Carteiras únicas por endereço. Uma mesma carteira listada em dois portais
 *  (a SOPA agrega gnars e skatehive) é UMA leitura, não duas. */
type SnapshotWallet = { projectSlug: string; label: string; address: string; extraTokens?: ExtraToken[] };

export function treasuryWallets(): SnapshotWallet[] {
  const seen = new Map<string, SnapshotWallet>();
  for (const p of getAllProjects()) {
    for (const w of p.treasury?.ethWallets ?? []) {
      const key = w.address.trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(key) || seen.has(key)) continue;
      // extraTokens viajam junto porque o leitor da PÁGINA os usa e o leitor
      // deste snapshot não — e essa diferença é exatamente o que se quer medir.
      seen.set(key, { projectSlug: p.slug, label: w.label, address: key, extraTokens: w.extraTokens });
    }
  }
  return [...seen.values()];
}

export async function snapshotTreasuryWalletsIfDue(now: number): Promise<{ ran: boolean; wrote?: number; skipped?: number; reason?: string }> {
  const last = await prisma.treasuryWalletSnapshot
    .findFirst({ orderBy: { takenAt: "desc" }, select: { takenAt: true } })
    .catch(() => null);
  if (last && now - last.takenAt.getTime() < EVERY_MS * 0.9) return { ran: false, reason: "ainda não é hora" };

  const list = treasuryWallets();
  let wrote = 0;
  let failed = 0;

  // Preços uma vez só, para o leitor da página (ele precisa de ETH e MOR) e
  // para as contas Hive mais abaixo.
  const prices = await getPrices().catch(() => null);

  for (const w of list) {
    const lido = await fetchAddressBalance(w.address, null).catch((e) => ({ error: String(e) }) as const);
    const bad = !("totalUsd" in lido) || lido.error;
    // O ponto do gráfico e a composição saem DAQUI, e o indexador tem um buraco
    // conhecido: a capital da Morpheus. Sem completar aqui, cada foto horária
    // grava o tesouro sem ela — e o dia em que o dinheiro foi aplicado desenha
    // uma QUEDA que nunca aconteceu. Foi exatamente o que a SOPA viu ao aplicar
    // 1.069 USDC. Completar na origem conserta o histórico e a composição de
    // uma vez; a mesma leitura na página vira redundante e se desliga sozinha
    // (a guarda de readDeclaredCapital compara saldo).
    const bal = await (async () => {
      if (bad) return lido;
      const base = lido as { totalUsd: number; tokens?: EvmToken[] };
      const faltando = await readDeclaredCapital(w.address, base.tokens ?? []).catch(() => [] as EvmToken[]);
      if (faltando.length === 0) return lido;
      return {
        ...lido,
        totalUsd: base.totalUsd + faltando.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0),
        tokens: [...(base.tokens ?? []), ...faltando].sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0)),
      };
    })();
    // REGRA: leitura que falhou NÃO vira um ponto de zero no gráfico. Um zero
    // gravado por engano desenha um despenhadeiro que nunca aconteceu, e depois
    // ninguém sabe se o tesouro esvaziou ou se o leitor caiu.
    //
    // Mas ela também não pode virar AUSÊNCIA de linha, que era o que acontecia:
    // sem linha, "a leitura falhou" fica indistinguível de "o cron não rodou",
    // e não dá pra contar o que não está lá. A falha agora é uma linha com
    // totalUsd nulo — nula não entra em gráfico e nula se conta.
    await prisma.treasuryWalletSnapshot
      .create({
        data: {
          projectSlug: w.projectSlug,
          label: w.label,
          address: w.address,
          kind: "evm",
          reader: "address",
          totalUsd: bad ? null : (bal as { totalUsd: number }).totalUsd,
          failedChains: "failedChains" in bal ? (bal.failedChains ?? []) : [],
          reason: bad ? (bal.error ?? "leitura falhou") : null,
          source: "source" in bal ? (bal.source ?? null) : null,
        },
      })
      .catch(() => {});
    if (bad) failed++;
    else wrote++;

    // A MESMA leitura que virou ponto no gráfico vira também a composição que a
    // página mostra. Zero requisição extra: já pagamos por ela acima.
    //
    // Só grava quando a leitura DEU CERTO. Guardar uma falha aqui faria a
    // página servir um tesouro vazio com cara de fresco — o oposto do que o
    // fallback existe para evitar.
    if (!bad) {
      const okBal = bal as {
        totalUsd: number;
        tokens: EvmToken[];
        failedChains?: string[];
        unpriced?: { symbol: string; balance: number }[];
        source?: string | null;
        unverifiedUsd?: number;
        unverifiedCount?: number;
      };
      await saveWalletComposition({
        address: w.address,
        label: w.label,
        projectSlug: w.projectSlug,
        source: okBal.source ?? "zerion",
        totalUsd: okBal.totalUsd,
        tokens: okBal.tokens ?? [],
        failedChains: okBal.failedChains ?? [],
        unpriced: okBal.unpriced,
        unverifiedUsd: okBal.unverifiedUsd,
        unverifiedCount: okBal.unverifiedCount,
      });
    }

    // ── O SEGUNDO leitor, na mesma hora ────────────────────────────────────
    // fetchEvmWallet é o que a PÁGINA usa: fan-out de RPC puro, cego para
    // posição de protocolo, mas o único que lê os extraTokens declarados na
    // config (USDCx, gnars). O de cima é Zerion-primeiro: enxerga protocolo e
    // não conhece extraToken nenhum.
    //
    // Enquanto os dois existirem, qualquer métrica de saúde colhida por um fala
    // do caminho DELE. Fotografar os dois na mesma hora transforma "eles
    // divergem" de suposição em número — e é esse número que decide se a
    // convergência deve trazer os extraTokens junto (opção 1) ou pode
    // dispensá-los (opção 3).
    //
    // Custo: fan-out de RPC público por carteira por hora. Não consome cota da
    // Zerion.
    if (prices) {
      const page = await fetchEvmWallet(
        { label: w.label, address: w.address, extraTokens: w.extraTokens },
        prices.eth,
        prices.mor,
      ).catch(() => null);
      const pageBad = !page || page.failedChains.length > 0;
      await prisma.treasuryWalletSnapshot
        .create({
          data: {
            projectSlug: w.projectSlug,
            label: w.label,
            address: w.address,
            kind: "evm",
            reader: "wallet",
            totalUsd: pageBad ? null : page!.totalUsd,
            failedChains: page?.failedChains ?? [],
            reason: pageBad ? (page?.error ?? "leitura da página falhou") : null,
            source: "rpc",
          },
        })
        .catch(() => {});
    }
  }

  // Hive na mesma foto. As contas Hive entram no total do hero exatamente como
  // as carteiras EVM, então uma medição de saúde que só olhasse EVM pareceria
  // completa sem ser — é o formato de erro que este trabalho inteiro persegue.
  // Uma chamada só para todas as contas, não uma por conta.
  const hive = treasuryHiveAccounts();
  if (hive.length > 0) {
    const reports = prices ? await hiveAccountBalances(hive, prices).catch(() => null) : null;
    for (const a of hive) {
      const r = reports?.find((x) => x.account === a.account);
      const bad = !r || !!r.error;
      await prisma.treasuryWalletSnapshot
        .create({
          data: {
            projectSlug: a.projectSlug,
            label: a.label,
            address: a.account,
            kind: "hive",
            totalUsd: bad ? null : r!.usd,
            reason: bad ? (r?.error ?? "leitura da Hive falhou") : null,
            source: "hive-rpc",
          },
        })
        .catch(() => {});
      if (bad) failed++;
      else wrote++;
    }
  }

  return { ran: true, wrote, skipped: failed };
}
