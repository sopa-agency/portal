import "server-only";
import { prisma } from "@/lib/prisma";
import { keccak256, toHex, decodeAbiParameters } from "viem";

// 0xSplits v2 (PullSplit) config, read from the chain instead of assumed.
//
// The portal used to hardcode "SOPA gets 50% of every swap split". That happened
// to be true, but a hardcoded share is a claim the UI can't back up: if anyone
// re-splits a contract, the treasury quietly reports the wrong number forever.
//
// PullSplit stores only a HASH of its config on-chain, so the recipients and
// allocations can't be read with a plain `eth_call` — they live in the
// `SplitUpdated((address[],uint256[],uint256,uint16))` event. We read the most
// recent one per split.
//
// Two sources, in order:
//   1. Blockscout's decoded-logs API — fast, pre-decoded, reachable from Vercel.
//   2. Raw `eth_getLogs` over an RPC — used when Blockscout is down (it has real
//      outages) so the treasury share + the org-chart orbit don't go blank with
//      it. Only a few public RPCs serve a full 0→latest, address-filtered range
//      in one call; the rest cap the block range or drop the method.

export type SplitRecipient = {
  address: string;
  /** Fraction of the split, 0–1. */
  share: number;
};

export type SplitConfig = {
  address: string;
  recipients: SplitRecipient[];
  /** Share going to `owner`, 0–1. Null when the address isn't a recipient. */
  shareFor: (owner: string) => number | null;
};

/**
 * The exact PullSplit struct needed to call `distribute()` — it must hash to the
 * config stored on-chain or the call reverts. Serialized as strings so it can
 * cross the server→client boundary (a server action) and be rebuilt with BigInt.
 */
export type SplitDistributeConfig = {
  address: string;
  recipients: string[];
  /** Raw allocations (out of totalAllocation), as decimal strings. */
  allocations: string[];
  totalAllocation: string;
  distributionIncentive: number;
};

const BLOCKSCOUT: Record<string, string> = {
  base: "https://base.blockscout.com",
};

// RPCs proven to serve a full-range, address-filtered `eth_getLogs` in one shot.
// Tried in order; the loop skips any that cap the range or error out.
// Cada entrada foi PROVADA contra o split real (0xAccF0d…) com fromBlock 0x0 →
// latest: as sete abaixo devolveram o log SplitUpdated numa tacada. Os RPCs
// públicos comuns (publicnode) capam a faixa em 50k blocos em gnosis/avalanche
// e o log é antigo demais pra caber — por isso Tenderly, não por preferência.
//
// bsc ficou de fora: não consegui provar nenhum endpoint de faixa completa. É
// ausência de prova, não prova de ausência — mas o mapa só carrega o que foi
// medido, e uma rede ausente aqui falha FECHADA (readSplitRaw devolve null) em
// vez de ler a rede errada.
const LOG_RPCS: Record<string, string[]> = {
  // mainnet.base.org entrou depois de medido: e o unico RPC publico de Base que
  // aceitou eth_getLogs de faixa completa nos testes (publicnode exige token de
  // archive, llamarpc devolveu HTML). Fica por ultimo, como rede de seguranca
  // quando os dois da Tenderly nao respondem.
  base: [
    "https://base.gateway.tenderly.co",
    "https://gateway.tenderly.co/public/base",
    "https://mainnet.base.org",
  ],
  ethereum: ["https://gateway.tenderly.co/public/mainnet"],
  optimism: ["https://gateway.tenderly.co/public/optimism"],
  arbitrum: ["https://gateway.tenderly.co/public/arbitrum"],
  polygon: ["https://gateway.tenderly.co/public/polygon"],
  gnosis: ["https://gateway.tenderly.co/public/gnosis"],
  avalanche: ["https://gateway.tenderly.co/public/avalanche"],
};

// keccak256("SplitUpdated((address[],uint256[],uint256,uint16))")
const SPLIT_UPDATED_TOPIC = keccak256(toHex("SplitUpdated((address[],uint256[],uint256,uint16))"));
const SPLIT_TUPLE = [
  {
    type: "tuple",
    components: [{ type: "address[]" }, { type: "uint256[]" }, { type: "uint256" }, { type: "uint16" }],
  },
] as const;

type DecodedParam = { name: string; value: unknown };
type LogItem = { decoded?: { method_call?: string; parameters?: DecodedParam[] } | null };

// The raw SplitUpdated tuple, decoded but not yet interpreted. Both the
// share-view (SplitConfig) and the distribute-view (SplitDistributeConfig) are
// built from this so the two readers can't drift.
type SplitRaw = { addrs: string[]; allocs: bigint[]; total: bigint; incentive: number };

/** Source 1 — Blockscout's decoded logs (newest-first). */
async function readViaBlockscout(host: string, address: string): Promise<SplitRaw | null> {
  const res = await fetch(`${host}/api/v2/addresses/${address}/logs`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
    next: { revalidate: 3600, tags: ["treasury"] },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { items?: LogItem[] };

  // Logs come newest-first, so the first SplitUpdated is the live config.
  const updated = (json.items ?? []).find((l) => (l.decoded?.method_call ?? "").startsWith("SplitUpdated"));
  const tuple = updated?.decoded?.parameters?.[0]?.value;
  if (!Array.isArray(tuple)) return null;

  const [addrs, allocs, totalRaw, incentiveRaw] = tuple as [unknown, unknown, unknown, unknown];
  if (!Array.isArray(addrs) || !Array.isArray(allocs)) return null;
  return {
    addrs: addrs.map(String),
    allocs: allocs.map((a) => BigInt(String(a))),
    total: BigInt(String(totalRaw)),
    incentive: Number(incentiveRaw ?? 0),
  };
}

/** Source 2 — raw `eth_getLogs`, decoded here (oldest-first, so take the last). */
async function readViaRpc(chain: string, address: string): Promise<SplitRaw | null> {
  const rpcs = LOG_RPCS[chain] ?? [];
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(9000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getLogs",
          params: [{ address, topics: [SPLIT_UPDATED_TOPIC], fromBlock: "0x0", toBlock: "latest" }],
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: Array<{ data: `0x${string}` }> };
      const logs = json.result;
      if (!Array.isArray(logs) || logs.length === 0) continue; // capped range / no event → next rpc

      // eth_getLogs returns ascending block order; the last is the live config.
      const [cfg] = decodeAbiParameters(SPLIT_TUPLE, logs[logs.length - 1].data);
      const [addrs, allocs, total, incentive] = cfg as unknown as [readonly string[], readonly bigint[], bigint, number];
      return { addrs: [...addrs], allocs: [...allocs], total, incentive: Number(incentive) };
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

/** Read the live SplitUpdated tuple, Blockscout first then RPC. */
async function readSplitRaw(address: string, chain: string | null): Promise<SplitRaw | null> {
  const key = chain ?? "base";
  const host = BLOCKSCOUT[key];
  if (host) {
    try {
      const viaExplorer = await readViaBlockscout(host, address);
      if (viaExplorer) return viaExplorer;
    } catch {
      // fall through to the RPC source
    }
  }
  return readViaRpc(key, address);
}

/**
 * Read a split's recipients + allocations. Returns null when the address isn't a
 * readable v2 split (unverified proxy, wrong chain, no event) — callers must
 * treat that as "unknown", never as a default share.
 */
// A configuração de um split, lembrada.
//
// `readSplitRaw` varre log de cadeia. Sem memória nenhuma, a página do tesouro
// refazia essa varredura por split A CADA render — e com o Blockscout da Base
// em 500 ela cai no RPC, que é o caminho lento. Medido: era a maior parte dos
// 30s que sobravam depois de o resto já estar em cache.
//
// Memória de processo e não banco, de propósito: recipients de split mudam por
// transação de governança, não de minuto a minuto, e um Map custa zero. O que
// isso NÃO cobre é instância fria na Vercel — a primeira visita de cada
// instância paga a leitura. Cobrir aquilo é tabela, e tabela para um dado que
// muda uma vez por mês é peso sem retorno.
//
// Só guarda SUCESSO. Cachear null transformaria um engasgo de rede num "este
// endereço não é split" que dura dez minutos — a mesma confusão entre "não li"
// e "não é" que o resto deste módulo existe para evitar.
const CFG_TTL_MS = 10 * 60_000;
const cfgCache = new Map<string, { at: number; value: SplitConfig }>();

/** Monta o objeto a partir dos destinatários já normalizados. */
function montar(address: string, recipients: SplitRecipient[]): SplitConfig {
  return {
    address,
    recipients,
    shareFor: (owner) => {
      const hit = recipients.find((r) => r.address.toLowerCase() === owner.toLowerCase());
      return hit ? hit.share : null;
    },
  };
}

export async function getSplitConfig(address: string, chain: string | null): Promise<SplitConfig | null> {
  const ck = `${chain ?? "all"}:${address.trim().toLowerCase()}`;
  const hit = cfgCache.get(ck);
  if (hit && Date.now() - hit.at < CFG_TTL_MS) return hit.value;

  // O BANCO ANTES DA CADEIA. O Map acima só serve a segunda visita da mesma
  // instância; na Vercel, instância fria é a regra e ela pagava 22s de
  // varredura de log por carregamento. Aqui o dado sobrevive ao processo.
  const doBanco = await prisma.splitConfigCache.findUnique({ where: { key: ck } }).catch(() => null);
  if (doBanco) {
    const recipients = (Array.isArray(doBanco.recipients) ? doBanco.recipients : []) as unknown as SplitRecipient[];
    if (recipients.length) {
      const cfg = montar(address, recipients);
      cfgCache.set(ck, { at: Date.now(), value: cfg });
      return cfg;
    }
  }

  const raw = await readSplitRaw(address, chain);
  if (!raw) return null;
  const total = Number(raw.total);
  if (!Number.isFinite(total) || total <= 0) return null;

  const recipients: SplitRecipient[] = raw.addrs.map((a, i) => ({
    address: a,
    share: Number(raw.allocs[i] ?? BigInt(0)) / total,
  }));
  if (recipients.some((r) => !Number.isFinite(r.share))) return null;

  const cfg = montar(address, recipients);
  cfgCache.set(ck, { at: Date.now(), value: cfg });
  // Grava sem esperar: a página já tem a resposta, e uma escrita de cache não
  // pode ser motivo para alguém olhar mais tempo para uma tela vazia.
  void prisma.splitConfigCache
    .upsert({
      where: { key: ck },
      create: { key: ck, address, chain, recipients: recipients as unknown as object },
      update: { recipients: recipients as unknown as object, syncedAt: new Date() },
    })
    .catch(() => {});
  return cfg;
}

/**
 * Read the exact struct needed to call `distribute()` on a PullSplit. Returns
 * null when the address isn't a readable v2 split. Values are strings so the
 * result can cross a server action; rebuild BigInts on the client.
 */
export async function getSplitDistributeConfig(
  address: string,
  chain: string | null,
): Promise<SplitDistributeConfig | null> {
  const raw = await readSplitRaw(address, chain);
  if (!raw || raw.addrs.length === 0 || raw.addrs.length !== raw.allocs.length) return null;
  if (raw.total <= BigInt(0)) return null;
  return {
    address,
    recipients: raw.addrs,
    allocations: raw.allocs.map((a) => a.toString()),
    totalAllocation: raw.total.toString(),
    distributionIncentive: raw.incentive,
  };
}
