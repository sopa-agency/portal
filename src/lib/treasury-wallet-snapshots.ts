import "server-only";
import { prisma } from "@/lib/prisma";
import { getAllProjects } from "@/projects/index";
import { fetchAddressBalance, getPrices, hiveAccountBalances } from "@/lib/treasury";

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
export function treasuryWallets(): { projectSlug: string; label: string; address: string }[] {
  const seen = new Map<string, { projectSlug: string; label: string; address: string }>();
  for (const p of getAllProjects()) {
    for (const w of p.treasury?.ethWallets ?? []) {
      const key = w.address.trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(key) || seen.has(key)) continue;
      seen.set(key, { projectSlug: p.slug, label: w.label, address: key });
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

  for (const w of list) {
    const bal = await fetchAddressBalance(w.address, null).catch((e) => ({ error: String(e) }) as const);
    const bad = !("totalUsd" in bal) || bal.error;
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
          totalUsd: bad ? null : (bal as { totalUsd: number }).totalUsd,
          failedChains: "failedChains" in bal ? (bal.failedChains ?? []) : [],
          reason: bad ? (bal.error ?? "leitura falhou") : null,
          source: "source" in bal ? (bal.source ?? null) : null,
        },
      })
      .catch(() => {});
    if (bad) failed++;
    else wrote++;
  }

  // Hive na mesma foto. As contas Hive entram no total do hero exatamente como
  // as carteiras EVM, então uma medição de saúde que só olhasse EVM pareceria
  // completa sem ser — é o formato de erro que este trabalho inteiro persegue.
  // Uma chamada só para todas as contas, não uma por conta.
  const hive = treasuryHiveAccounts();
  if (hive.length > 0) {
    const prices = await getPrices().catch(() => null);
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
