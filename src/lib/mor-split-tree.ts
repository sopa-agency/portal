import "server-only";

// Quem recebe o que no fim do pipeline do MOR — LIDO DA CADEIA.
//
// O diagrama dizia "80% SOPA, 20% Gnars" escrito à mão no dicionário. Em
// 29/08 às 15:57 UTC o split foi refeito na cadeia para 40/40/20, com os novos
// 40% indo para um split aninhado de 10 pessoas — e o portal seguiu afirmando
// 80/20 por um dia inteiro, com a confiança de sempre.
//
// É exatamente o que o src/lib/splits.ts foi escrito para evitar: share fixa é
// uma afirmação que a interface não consegue sustentar. Então o diagrama passa
// a ler, e a única coisa fixa aqui é o endereço do split — que é o que de fato
// não muda.

import { getSplitConfig } from "@/lib/splits";
import { PIPELINE } from "@/lib/mor-pipeline";
import { unread, type Reading } from "@/lib/reading";

export type SplitLeaf = {
  address: string;
  share: number;
  /** ENS, quando existe. Nunca inventado: sem nome, a interface mostra o endereço. */
  ens: string | null;
  /** Preenchido quando este destinatário é ELE MESMO um split. */
  nested: { address: string; share: number; ens: string | null }[] | null;
};

const ENS_TIMEOUT_MS = 4_000;
const TTL_MS = 10 * 60_000;
let cache: { at: number; value: Reading<SplitLeaf[]> } | null = null;

/**
 * Nomes por ENS reverso, na mainnet, tudo em paralelo e best-effort.
 *
 * Falhar aqui NÃO é falhar a leitura: nome é enfeite, share é o dado. Sem nome,
 * o endereço aparece — o que nunca pode acontecer é a linha sumir por não ter
 * conseguido resolver o apelido de alguém.
 */
async function resolveEns(addresses: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");
    const client = createPublicClient({
      chain: mainnet,
      transport: http("https://ethereum-rpc.publicnode.com"),
    });
    const names = await Promise.race([
      Promise.all(
        addresses.map((a) =>
          client
            .getEnsName({ address: a as `0x${string}` })
            .catch(() => null)
            .then((n) => [a.toLowerCase(), n] as const),
        ),
      ),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ens timeout")), ENS_TIMEOUT_MS)),
    ]);
    for (const [a, n] of names) if (n) out.set(a, n);
  } catch {
    // sem nomes; os endereços seguem
  }
  return out;
}

/**
 * A árvore do split final: destinatários diretos e, para os que são split,
 * os destinatários deles.
 *
 * Devolve Reading porque a leitura pode falhar, e uma falha aqui NÃO pode virar
 * "o split não tem ninguém" — o diagrama mostraria uma caixa vazia com cara de
 * verdade. Falhou, diz que falhou.
 */
export async function getMorSplitTree(): Promise<Reading<SplitLeaf[]>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  let value: Reading<SplitLeaf[]>;
  try {
    const top = await getSplitConfig(PIPELINE.downstreamSplit, "base");
    if (!top) throw new Error("o split final não devolveu configuração");

    const leaves: SplitLeaf[] = [];
    for (const r of top.recipients) {
      // Um destinatário que é split abre em mais um nível. Um nível só: se um
      // dia houver split dentro de split dentro de split, isso vira decisão de
      // desenho e não recursão silenciosa.
      const inner = await getSplitConfig(r.address, "base").catch(() => null);
      leaves.push({
        address: r.address,
        share: r.share,
        ens: null,
        nested: inner ? inner.recipients.map((x) => ({ address: x.address, share: x.share, ens: null })) : null,
      });
    }

    const todos = [
      ...leaves.map((l) => l.address),
      ...leaves.flatMap((l) => l.nested?.map((n) => n.address) ?? []),
    ];
    const ens = await resolveEns(todos);
    for (const l of leaves) {
      l.ens = ens.get(l.address.toLowerCase()) ?? null;
      for (const n of l.nested ?? []) n.ens = ens.get(n.address.toLowerCase()) ?? null;
    }

    value = { state: "ok", value: leaves, asOf: Date.now() };
  } catch (e) {
    value = unread<SplitLeaf[]>(e instanceof Error ? e.message : String(e));
  }
  cache = { at: Date.now(), value };
  return value;
}
