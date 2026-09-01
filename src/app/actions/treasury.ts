"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { fetchOnchainRevenueCached } from "@/lib/revenue-onchain";

/**
 * Atualizar o tesouro, de verdade.
 *
 * Antes esta ação só chamava `revalidatePath`, e isso resolvia quando a página
 * lia tudo ao vivo. Agora que as leituras caras moram em cache — porque ler
 * cadeia dentro de um render levou a página a 26s — revalidar sozinho só
 * redesenharia os MESMOS números guardados. Atualizar tem que forçar a leitura.
 *
 * É aqui, e só aqui, que a espera é justa: a pessoa clicou e está olhando.
 */
export async function refreshTreasury(): Promise<{ ok: true; falhas: string[] }> {
  const rows = await prisma.sopaBoard.findMany({ where: { board: "orgchart" } }).catch(() => []);

  const alvos = new Map<string, { address: string; chain: string | null }>();
  for (const r of rows) {
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : {};
    for (const s of Array.isArray(meta.revenueStreams) ? (meta.revenueStreams as Record<string, unknown>[]) : []) {
      const address = typeof s?.address === "string" ? s.address.trim() : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
      const chain = s.chain == null || s.chain === "all" ? null : String(s.chain);
      alvos.set(`${chain ?? "all"}:${address.toLowerCase()}`, { address, chain });
    }
  }

  // Em paralelo: são leituras independentes, e enfileirá-las faria a espera ser
  // a SOMA delas em vez da mais lenta.
  const falhas: string[] = [];
  await Promise.all(
    [...alvos.values()].map((t) =>
      fetchOnchainRevenueCached(t.address, t.chain, { force: true })
        .then((r) => {
          // Ler e falhar não é ler e não ter nada. A falha volta nomeada para o
          // botão poder ficar vermelho em vez de fingir sucesso.
          if (r.error && r.count === 0) falhas.push(`${t.address.slice(0, 8)}…`);
        })
        .catch(() => falhas.push(`${t.address.slice(0, 8)}…`)),
    ),
  );

  revalidatePath("/treasury");
  return { ok: true, falhas };
}
