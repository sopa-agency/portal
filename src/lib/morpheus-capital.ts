import "server-only";

// A posição da SOPA na capital da Morpheus — e o claim que traz o MOR de volta.
//
// POR QUE ISTO EXISTE
//
// O portal só conhecia o subnet, na Base. A capital é outra coisa e mora noutro
// lugar: o depósito é na Ethereum mainnet, e o MOR do claim é MINTADO NA
// ARBITRUM. Três redes numa operação só, e nenhuma delas conversava com a tela.
//
// Sem isto, o rendimento dependeria de alguém lembrar de claimar na mão. A gente
// já sabe no que isso dá: o briefing do secretário tem 50 dias, o trail parou em
// julho. O que depende de memória humana para acontecer, não acontece.
//
// O CLAIM NÃO PASSA PELO SPLIT, e essa é a decisão que mais importa aqui.
//
// `claim(poolId, receiver)` aceita qualquer endereço. Mandar para o topSplit da
// Base entregaria 54% do rendimento ao time e à Gnars — mas emissão de subnet é
// comunal, e rendimento de capital é retorno sobre o dinheiro da própria SOPA.
// Naquela taxa, é a diferença entre 14% e 6,5%. O receiver é o Safe, sempre.

import { getAddress } from "viem";
import { attempt, insufficient, type Reading } from "@/lib/reading";

/** Pools de depósito da Morpheus na mainnet, do registro oficial deles. */
export const MORPHEUS_POOLS = {
  usdc: getAddress("0x6cCE082851Add4c535352f596662521B4De4750E"),
  stETH: getAddress("0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790"),
} as const;

/** O índice do reward pool dentro do DepositPool. Medido: é o 0 que tem depósito. */
export const REWARD_POOL_INDEX = 0;

const RPCS = ["https://gateway.tenderly.co/public/mainnet", "https://ethereum-rpc.publicnode.com"];

/** usersData(address,uint256) · getLatestUserReward(uint256,address) · totalDepositedInPublicPools() */
const SEL = {
  usersData: "0x30dc6308",
  reward: "0xa55ae979",
  totalDeposited: "0xd2ba5e3a",
} as const;

const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const word = (n: number) => n.toString(16).padStart(64, "0");

async function call(to: string, data: string): Promise<string | null> {
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      });
      const j = (await r.json()) as { result?: string };
      if (j.result && j.result !== "0x") return j.result;
    } catch {
      // próximo RPC
    }
  }
  return null;
}

export type CapitalPosition = {
  pool: string;
  /** Quanto está depositado, no ativo do pool. */
  deposited: number;
  /** MOR acumulado e ainda não reclamado. */
  pendingMor: number;
  /** Depósito × multiplicador. Igual ao depósito quando não há trava. */
  virtual: number;
  /** virtual / deposited. ~1,01 sem trava; até 7 com trava de anos. */
  multiplier: number;
  /** Quando foi o último stake — a janela de acúmulo começa aqui. */
  stakedAt: Date | null;
  /**
   * Antes disto o claim REVERTE. Todo depósito rearma a trava de 7 dias — o
   * painel mostra a data porque "por que não consigo claimar?" é a primeira
   * pergunta que alguém vai fazer olhando o MOR acumulado.
   */
  claimLockEnd: Date | null;
  /** Tamanho do pool inteiro, para dar noção de quanto a fatia pesa. */
  poolTotal: number;
};

/**
 * A posição de um endereço no pool de USDC.
 *
 * Devolve Reading porque a leitura atravessa RPC público e pode falhar — e uma
 * falha aqui NÃO pode virar "não há posição". Zero depositado e zero lido são a
 * mesma tela com significados opostos, e num painel de tesouraria a diferença
 * decide se alguém vai atrás do dinheiro ou não.
 */
export async function readCapitalPosition(owner: string): Promise<Reading<CapitalPosition>> {
  return attempt(async () => {
    const pool = MORPHEUS_POOLS.usdc;
    const [ud, rw, tot] = await Promise.all([
      call(pool, SEL.usersData + pad(owner) + word(REWARD_POOL_INDEX)),
      call(pool, SEL.reward + word(REWARD_POOL_INDEX) + pad(owner)),
      call(pool, SEL.totalDeposited),
    ]);
    if (!ud) throw new Error("o pool de USDC da Morpheus não respondeu");

    const w: bigint[] = [];
    for (let i = 2; i < ud.length; i += 64) w.push(BigInt("0x" + ud.slice(i, i + 64)));

    const deposited = Number(w[1] ?? BigInt(0)) / 1e6;
    const virtual = Number(w[6] ?? BigInt(0)) / 1e6;
    const stakedAtSec = Number(w[0] ?? BigInt(0));

    return {
      pool,
      deposited,
      pendingMor: rw ? Number(BigInt(rw)) / 1e18 : 0,
      virtual,
      // Sem depósito não há multiplicador — e 0/0 viraria NaN na tela.
      multiplier: deposited > 0 ? virtual / deposited : 1,
      stakedAt: stakedAtSec > 0 ? new Date(stakedAtSec * 1000) : null,
      poolTotal: tot ? Number(BigInt(tot)) / 1e6 : 0,
    };
  }, (e) => `posição na Morpheus não leu: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * O rendimento anualizado que ESTA posição vem tendo, medido.
 *
 * Não é o APY anunciado por ninguém: é o MOR acumulado dividido pelo depósito,
 * sobre a janela real desde o último stake. Devolve `insufficient` quando a
 * janela é curta demais para significar coisa alguma — extrapolar seis horas
 * para um ano produz um número grande e falso, e número falso num painel de
 * tesouraria é pior que número nenhum.
 */
export function realizedApy(pos: CapitalPosition, morPriceUsd: number): Reading<number> {
  if (!pos.stakedAt || pos.deposited <= 0) return insufficient<number>("sem posição para medir");
  const dias = (Date.now() - pos.stakedAt.getTime()) / 86_400_000;
  if (dias < 1) return insufficient<number>(`só ${(dias * 24).toFixed(1)}h desde o depósito — cedo para anualizar`);
  const ganho = pos.pendingMor * morPriceUsd;
  return { state: "ok", value: (ganho / pos.deposited) * (365 / dias), asOf: Date.now() };
}
