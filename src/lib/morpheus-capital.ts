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
  /** rewardPoolsProtocolDetails(uint256) — traz as travas do protocolo. */
  protocolDetails: "0x214a6525",
  /** claim(uint256,address) — payable: o msg.value paga a ponte LayerZero. */
  claim: "0xddd5e1b2",
} as const;

/**
 * O claim é bloqueado por DUAS travas, e elas são coisas diferentes.
 *
 *   (1) a do PROTOCOLO: `lastStake + claimLockPeriodAfterStake`, hoje 7 dias.
 *       Todo depósito a rearma, ninguém escolhe, e é ela que devolve o revert
 *       "DS: pool claim is locked (S)".
 *   (2) a do USUÁRIO: `claimLockEnd`, a trava opcional que multiplica o
 *       rendimento. A SOPA recusou; a conta pessoal do Vlad está travada até
 *       2028 justamente por ter aceitado.
 *
 * Vale a MAIOR das duas. Mostrar só a do usuário (como o painel fazia) acerta
 * por acidente quando não há trava opcional e mente quando há.
 */
export function claimUnlockAt(pos: { stakedAt: Date | null; claimLockEnd: Date | null; lockAfterStakeSec: number }): Date | null {
  const protocolo = pos.stakedAt ? pos.stakedAt.getTime() + pos.lockAfterStakeSec * 1000 : null;
  const usuario = pos.claimLockEnd?.getTime() ?? null;
  const maior = Math.max(protocolo ?? 0, usuario ?? 0);
  return maior > 0 ? new Date(maior) : null;
}

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
  /** `claimLockPeriodAfterStake` do protocolo, em segundos (hoje 604800 = 7d). */
  lockAfterStakeSec: number;
  /** A trava que de fato vale: a maior entre a do protocolo e a do usuário. */
  claimOpensAt: Date | null;
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
    const [ud, rw, tot, det] = await Promise.all([
      call(pool, SEL.usersData + pad(owner) + word(REWARD_POOL_INDEX)),
      call(pool, SEL.reward + word(REWARD_POOL_INDEX) + pad(owner)),
      call(pool, SEL.totalDeposited),
      call(pool, SEL.protocolDetails + word(REWARD_POOL_INDEX)),
    ]);
    if (!ud) throw new Error("o pool de USDC da Morpheus não respondeu");

    const w: bigint[] = [];
    for (let i = 2; i < ud.length; i += 64) w.push(BigInt("0x" + ud.slice(i, i + 64)));

    const deposited = Number(w[1] ?? BigInt(0)) / 1e6;
    const virtual = Number(w[6] ?? BigInt(0)) / 1e6;
    const stakedAtSec = Number(w[0] ?? BigInt(0));
    const stakedAt = stakedAtSec > 0 ? new Date(stakedAtSec * 1000) : null;
    // Trava MÍNIMA do protocolo entre depositar e poder reclamar — hoje sete
    // dias, mas LIDA do contrato: se a Morpheus mudar, a tela acompanha em vez
    // de repetir um 7 escrito à mão. A ordem é [withdrawLockAfterStake,
    // claimLockAfterStake, claimLockAfterClaim, minimalStake, totalVirtual].
    const d: bigint[] = [];
    if (det) for (let i = 2; i < det.length; i += 64) d.push(BigInt("0x" + det.slice(i, i + 64)));
    const lockAfterStake = Number(d[1] ?? BigInt(0)) || 604800;
    const claimLockEnd = Number(w[5] ?? BigInt(0)) > 0 ? new Date(Number(w[5]) * 1000) : null;

    return {
      pool,
      deposited,
      pendingMor: rw ? Number(BigInt(rw)) / 1e18 : 0,
      virtual,
      // Sem depósito não há multiplicador — e 0/0 viraria NaN na tela.
      multiplier: deposited > 0 ? virtual / deposited : 1,
      stakedAt,
      claimLockEnd,
      poolTotal: tot ? Number(BigInt(tot)) / 1e6 : 0,
      lockAfterStakeSec: lockAfterStake,
      claimOpensAt: claimUnlockAt({ stakedAt, claimLockEnd, lockAfterStakeSec: lockAfterStake }),
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

// ─────────────────────────────────────────────────────────────────────────────
// O CLAIM
//
// `claim(rewardPoolIndex, receiver)` é PAYABLE, e isso não é detalhe: o MOR não
// é mintado aqui. Ele é mintado na Arbitrum, e o `msg.value` paga a mensagem
// LayerZero que atravessa. Chamar com value 0 reverte com `d_O` — um erro de
// quatro caracteres que não explica nada a ninguém.
//
// A taxa é dinâmica e o contrato não expõe cotação (procurei: não há previewFee
// nem quote). Então ela é MEDIDA contra o próprio contrato, por busca binária
// em cima de eth_call. É mais lento que ler uma variável e é a única forma
// honesta: o número sai de quem vai cobrá-lo, não de um palpite nosso.

/** eth_call com `from`, `value` e saldo forjado. Devolve só se passou. */
async function simClaim(pool: string, from: string, receiver: string, value: bigint): Promise<boolean> {
  const data = SEL.claim + word(REWARD_POOL_INDEX) + pad(receiver);
  // O saldo forjado desacopla a sondagem do caixa real: sem ele, um Safe com
  // pouco ETH faria a própria medição falhar e a gente concluiria "não dá para
  // reclamar" quando o que falta é ETH — dois problemas diferentes, com
  // soluções diferentes.
  const override = { [from]: { balance: "0x" + (BigInt(10) * BigInt(1e18)).toString(16) } };
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ from, to: pool, data, value: "0x" + value.toString(16) }, "latest", override],
        }),
      });
      const j = (await r.json()) as { result?: string; error?: unknown };
      if (j.error) return false;
      if (j.result !== undefined) return true;
    } catch {
      // próximo RPC
    }
  }
  return false;
}

/** Teto da sondagem. Acima disto não é taxa, é outra coisa errada. */
const FEE_CEILING = BigInt(50_000_000_000_000_000); // 0,05 ETH

/**
 * A taxa mínima do LayerZero para ESTE claim, agora, medida no contrato.
 *
 * `insufficient` quando nem o teto passa — quase sempre porque a trava ainda
 * não venceu, e nesse caso o problema não é taxa nenhuma.
 */
export async function probeClaimFee(owner: string, receiver: string): Promise<Reading<bigint>> {
  const pool = MORPHEUS_POOLS.usdc;
  const from = getAddress(owner);
  const to = getAddress(receiver);
  if (!(await simClaim(pool, from, to, FEE_CEILING))) {
    return insufficient<bigint>("o claim não passa nem com 0,05 ETH de taxa — provavelmente a trava ainda não venceu");
  }
  let lo = BigInt(0);
  let hi = FEE_CEILING;
  // 24 passos levam 0,05 ETH a ~3 wei de precisão. Cada passo é um eth_call.
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / BigInt(2);
    if (await simClaim(pool, from, to, mid)) hi = mid;
    else lo = mid;
  }
  return { state: "ok", value: hi, asOf: Date.now() };
}

/** Calldata do claim, para quem vai propor a transação. */
export function claimCalldata(receiver: string): `0x${string}` {
  return (SEL.claim + word(REWARD_POOL_INDEX) + pad(getAddress(receiver))) as `0x${string}`;
}
