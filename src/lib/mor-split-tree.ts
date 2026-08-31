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
  /**
   * Este destinatário é ele mesmo um split?
   *
   *   "no"      — lido, e não é split: é carteira/contrato final
   *   "unread"  — NÃO consegui ler. Não é o mesmo que "não é split", e por isso
   *               não compartilha o mesmo valor. Foi assim que a versão
   *               anterior mentiu: `.catch(() => null)` juntava as duas, e a
   *               tela mostrava o split da equipe como se fosse um endereço
   *               qualquer, sem dizer que havia gente atrás.
   *   "ok"      — lido, é split, e `nested` traz quem recebe.
   */
  nestedState: "no" | "unread" | "ok";
  nestedReason: string | null;
  nested: { address: string; share: number; ens: string | null }[] | null;
};

const ENS_TIMEOUT_MS = 4_000;

/** Endereço sem bytecode é carteira: não pode ser split, e isso é afirmável. */
async function hasNoCode(address: string): Promise<boolean> {
  try {
    const res = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
    });
    const j = (await res.json()) as { result?: string };
    return j.result === "0x";
  } catch {
    return false; // não deu para saber → não afirmamos "não é split"
  }
}
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
      // Tenderly, e não publicnode: RPC público costuma recusar IP de
      // datacenter, e esta chamada roda na Vercel. É a mesma rota que o
      // splits.ts já usa para ler log de lá.
      transport: http("https://gateway.tenderly.co/public/mainnet"),
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
      let nestedState: SplitLeaf["nestedState"] = "no";
      let nestedReason: string | null = null;
      let nested: SplitLeaf["nested"] = null;

      // Destinos que a gente CONHECE não são interrogados.
      //
      // O multisig da SOPA e o tesouro da Gnars têm código (são Safes), então a
      // regra genérica os classificava como "tem código e não achei evento de
      // split" — e a tela avisava que talvez houvesse gente atrás deles. Aviso
      // falso é pior que aviso nenhum: ensina a ignorar o aviso verdadeiro,
      // que é o do split da equipe quando ele não lê.
      //
      // Isto fixa IDENTIDADE (este endereço é o tesouro da SOPA), não SHARE —
      // e identidade é o que o PIPELINE já declara. As porcentagens seguem
      // vindo todas da cadeia. De quebra, poupa duas varreduras de log por
      // montagem.
      const conhecidos = [PIPELINE.sopa, PIPELINE.gnarsTreasury].map((a) => a.toLowerCase());
      if (conhecidos.includes(r.address.toLowerCase())) {
        leaves.push({ address: r.address, share: r.share, ens: null, nestedState: "no", nestedReason: null, nested: null });
        continue;
      }

      try {
        const inner = await getSplitConfig(r.address, "base");
        if (inner) {
          nestedState = "ok";
          nested = inner.recipients.map((x) => ({ address: x.address, share: x.share, ens: null }));
        }
        // inner === null: getSplitConfig devolve null tanto para "não é split"
        // quanto para "não achei o evento". Só dá para separar as duas com um
        // sinal a mais — endereço SEM CÓDIGO não pode ser split, e aí "no" é
        // afirmação segura. Com código e sem evento, fica "unread".
        else if (await hasNoCode(r.address)) nestedState = "no";
        else {
          nestedState = "unread";
          nestedReason = "tem código, mas não achei o evento SplitUpdated";
        }
      } catch (e) {
        nestedState = "unread";
        nestedReason = e instanceof Error ? e.message : String(e);
      }
      leaves.push({ address: r.address, share: r.share, ens: null, nestedState, nestedReason, nested });
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
