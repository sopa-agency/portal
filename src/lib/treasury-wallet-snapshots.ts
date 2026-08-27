import "server-only";
import { prisma } from "@/lib/prisma";
import { getAllProjects } from "@/projects/index";
import { fetchAddressBalance } from "@/lib/treasury";

// Fotografa o saldo de cada carteira de tesouro configurada, de hora em hora.
//
// Uma requisição POR CARTEIRA, não por carteira × rede: fetchAddressBalance sem
// chain usa o caminho Zerion, que devolve todas as redes de uma vez. Com ~5
// carteiras isso é ~5 requisições por hora — e passa a enxergar redes que o
// fan-out por RPC nem conhece (a gnosis, por exemplo, onde o Safe da SOPA tem
// posição).

const EVERY_MS = 60 * 60 * 1000;

/** Carteiras únicas por endereço. Uma mesma carteira listada em dois portais
 *  (a SOPA agrega gnars e skatehive) é UMA leitura, não duas. */
function wallets(): { projectSlug: string; label: string; address: string }[] {
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

  const list = wallets();
  let wrote = 0;
  let skipped = 0;
  for (const w of list) {
    const bal = await fetchAddressBalance(w.address, null).catch(() => null);
    // REGRA: leitura que falhou NÃO vira um ponto de zero no gráfico. Um zero
    // gravado por engano desenha um despenhadeiro que nunca aconteceu, e depois
    // ninguém sabe se o tesouro esvaziou ou se o leitor caiu.
    if (!bal || bal.error) {
      skipped++;
      continue;
    }
    await prisma.treasuryWalletSnapshot
      .create({ data: { projectSlug: w.projectSlug, label: w.label, address: w.address, totalUsd: bal.totalUsd, source: bal.source ?? null } })
      .catch(() => {});
    wrote++;
  }
  return { ran: true, wrote, skipped };
}
