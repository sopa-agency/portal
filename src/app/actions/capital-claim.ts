"use server";

import { getAddress } from "viem";
import { proposeSafeTx } from "@/lib/safe-propose";
import { autorizarSafe } from "@/lib/safe-authz";
import {
  MORPHEUS_POOLS,
  POOL_ASSET,
  claimCalldata,
  probeClaimFee,
  readCapitalPosition,
  type PoolKey,
} from "@/lib/morpheus-capital";
import { isOk } from "@/lib/reading";

const MAINNET = 1;

// A taxa medida vale para o bloco de agora. Entre propor e os donos assinarem
// passam horas, e ela anda com o gás. 1,5× é a folga — sobre US$ 0,13, custa
// centavos; sem ela, a assinatura chega e a transação reverte por um fio.
const MARGEM = { num: BigInt(3), den: BigInt(2) };

const MAINNET_RPCS = ["https://gateway.tenderly.co/public/mainnet", "https://ethereum-rpc.publicnode.com"];
const ARBITRUM_RPCS = ["https://arbitrum-one-rpc.publicnode.com", "https://gateway.tenderly.co/public/arbitrum"];

async function rpc(rpcs: string[], method: string, params: unknown[]): Promise<string | null> {
  for (const url of rpcs) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = (await r.json()) as { result?: string };
      if (typeof j.result === "string") return j.result;
    } catch {
      // próximo RPC
    }
  }
  return null;
}

/** Saldo de ETH do Safe na mainnet — o msg.value sai daqui, não do bolso de quem assina. */
async function ethBalance(addr: string): Promise<bigint | null> {
  const hex = await rpc(MAINNET_RPCS, "eth_getBalance", [addr, "latest"]);
  return hex ? BigInt(hex) : null;
}

/**
 * O MOR é mintado na ARBITRUM, no endereço do receiver. Um Safe é um contrato:
 * se ele não existir lá, o MOR cai num endereço que ninguém controla até
 * alguém replicar o Safe naquela rede. `null` = não deu para saber.
 */
async function existeNaArbitrum(addr: string): Promise<boolean | null> {
  const code = await rpc(ARBITRUM_RPCS, "eth_getCode", [addr, "latest"]);
  if (code == null) return null;
  return code.length > 2;
}

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

/**
 * Propõe o claim do MOR da capital: uma transação no Safe dono da posição, na
 * MAINNET, contra o DepositPool daquele ativo (USDC e stETH são contratos
 * diferentes, cada um com o seu claim e a sua trava).
 *
 * O receiver é o próprio Safe, sempre. `claim` aceita qualquer endereço, e
 * apontá-lo para um split entregaria parte do rendimento do capital a quem
 * não o aportou — a decisão está escrita em `morpheus-capital.ts` e é
 * reafirmada aqui porque este é o único lugar que a executa.
 *
 * Nada sai sem as assinaturas dos donos: isto só monta e enfileira.
 */
export async function proposeCapitalClaim(args: { safe: string; pool: PoolKey }): Promise<
  { ok: true; url: string; mor: string; feeEth: string } | { ok: false; error: string }
> {
  if (!(args.pool in MORPHEUS_POOLS)) return { ok: false, error: "Pool desconhecido." };
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;

  const safe = getAddress(args.safe);
  const { symbol } = POOL_ASSET[args.pool];
  try {
    const pos = await readCapitalPosition(safe, args.pool);
    // Sem leitura não se propõe: um claim montado às cegas pode estar travado,
    // vazio, ou os dois — e o revert só apareceria na cara de quem assina.
    if (!isOk(pos)) return { ok: false, error: "Não consegui ler a posição na Morpheus agora. Tenta de novo." };
    const p = pos.value;
    if (p.deposited <= 0) return { ok: false, error: `Não há posição no pool de ${symbol} da Morpheus.` };
    if (p.pendingMor <= 0) return { ok: false, error: "Ainda não há MOR acumulado para reclamar." };
    if (p.claimOpensAt && p.claimOpensAt.getTime() > Date.now()) {
      return { ok: false, error: `O claim ainda está travado até ${p.claimOpensAt.toLocaleDateString("pt-BR")}.` };
    }

    const naArb = await existeNaArbitrum(safe);
    if (naArb === false) {
      return {
        ok: false,
        error: `${auth.label} não existe na Arbitrum, e é lá que o MOR é mintado. Replica o Safe na Arbitrum antes, senão o MOR cai num endereço sem dono.`,
      };
    }
    if (naArb === null) return { ok: false, error: "Não consegui confirmar que o Safe existe na Arbitrum. Tenta de novo." };

    const fee = await probeClaimFee(safe, safe, args.pool);
    if (!isOk(fee)) {
      return { ok: false, error: fee.state === "insufficient" ? fee.note : fee.reason };
    }
    const value = (fee.value * MARGEM.num) / MARGEM.den;

    // O ETH é do Safe. Avisar ANTES é a diferença entre "faltam 0,00002 ETH no
    // Safe" e uma transação enfileirada que reverte na hora de executar.
    const saldo = await ethBalance(safe);
    if (saldo != null && saldo < value) {
      return { ok: false, error: `O Safe tem ${eth(saldo)} ETH na mainnet e a ponte custa ${eth(value)}. Manda um pouco de ETH pro Safe antes.` };
    }

    const res = await proposeSafeTx({
      chainId: MAINNET,
      safe,
      to: MORPHEUS_POOLS[args.pool],
      data: claimCalldata(safe),
      value,
      origin: `${auth.label}: claim do MOR da capital (${symbol}, mintado na Arbitrum)`,
    });
    if (!res.ok) return res;
    return { ok: true, url: res.url, mor: p.pendingMor.toFixed(4), feeEth: eth(value) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor o claim." };
  }
}
