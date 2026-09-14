"use server";

import { getAddress } from "viem";
import { autorizarSafe } from "@/lib/safe-authz";
import { proposeSafeBatch } from "@/lib/safe-propose";
import { ARBITRUM, bridgeNonce, execParams, quoteOft, quoteSwapsPro, readBridgeContext, simulateAsSafe, type BridgeContext, type BridgeQuote } from "@/lib/mor-bridge";

/**
 * A ponte do MOR (Arbitrum → Base) a partir do painel de capital.
 *
 * Cotar não custa nada e não muda nada, mas é gated pela mesma regra do propor
 * — o painel só aparece com sessão, e uma cotação sem quem possa agir é só
 * curiosidade. Propor enfileira no Safe DA ARBITRUM: os donos assinam lá
 * (1-de-3 na SOPA, 1-de-2 na SkateHive — configuração do dia zero dos Safes
 * naquela rede).
 */

export type PonteCotacao = {
  ok: true;
  morArb: string;
  swapspro: { ok: true; quote: PonteRota } | { ok: false; error: string };
  oft: { ok: true; quote: PonteRota } | { ok: false; error: string };
};

/** A cotação sem as chamadas: o cliente não precisa (nem deve) ver calldata. */
export type PonteRota = Omit<BridgeQuote, "calls">;

const semCalls = (q: BridgeQuote): PonteRota => ({
  via: q.via,
  sends: q.sends,
  receives: q.receives,
  floor: q.floor,
  costEth: q.costEth,
  lossMor: q.lossMor,
  provider: q.provider,
  expiresAt: q.expiresAt,
  deadline: q.deadline,
});

async function cotar(safe: string, amountWei: bigint) {
  const [sp, oft] = await Promise.allSettled([quoteSwapsPro(safe, amountWei), quoteOft(safe, amountWei)]);
  const wrap = (r: PromiseSettledResult<BridgeQuote>) =>
    r.status === "fulfilled"
      ? ({ ok: true, quote: semCalls(r.value) } as const)
      : ({ ok: false, error: (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 200) } as const);
  return { sp: wrap(sp), oft: wrap(oft), raw: { sp, oft } };
}

export async function quoteMorBridge(args: { safe: string }): Promise<PonteCotacao | { ok: false; error: string }> {
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;
  const safe = getAddress(args.safe);
  const ctx = await readBridgeContext(safe);
  const amount = BigInt(ctx.morArbWei);
  if (amount <= BigInt(0)) return { ok: false, error: "Não há MOR parado na Arbitrum para este Safe." };
  const { sp, oft } = await cotar(safe, amount);
  return { ok: true, morArb: ctx.morArb, swapspro: sp, oft };
}

export async function proposeMorBridge(args: { safe: string; via: "swapspro" | "oft" }): Promise<
  { ok: true; url: string; receives: string; provider: string; deadline?: number; replaced: boolean } | { ok: false; error: string }
> {
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;
  const safe = getAddress(args.safe);
  try {
    const ctx = await readBridgeContext(safe);
    const amount = BigInt(ctx.morArbWei);
    if (amount <= BigInt(0)) return { ok: false, error: "Não há MOR parado na Arbitrum para este Safe." };

    // Cota DE NOVO na hora de propor: a cotação que a pessoa viu pode ter
    // minutos, e é a de agora que vai para a fila.
    const quote = args.via === "oft" ? await quoteOft(safe, amount) : await quoteSwapsPro(safe, amount);

    // O ETH da Arbitrum paga a taxa (OFT) ou só o gás (swaps.pro). Avisar antes
    // de enfileirar: uma proposta que reverte por falta de ETH só aparece na
    // cara de quem assina.
    const precisa = quote.calls.reduce((s, c) => s + (c.value ?? BigInt(0)), BigInt(0));
    const ethArb = BigInt(Math.round(Number(ctx.ethArb === "?" ? "0" : ctx.ethArb) * 1e18));
    if (ctx.ethArb !== "?" && ethArb < precisa) {
      return { ok: false, error: `O Safe tem ${ctx.ethArb} ETH na Arbitrum e esta rota precisa de ${quote.costEth}. Manda um pouco de ETH pro Safe lá antes.` };
    }

    // Roda o batch como o Safe vai rodar. Uma proposta que já não executa
    // agora não entra na fila — o erro vem para cá, com motivo, e não para
    // quem for assinar daqui a dez minutos.
    const sim = await simulateAsSafe(safe, quote.calls);
    if (!sim.ok) {
      return { ok: false, error: `A rota não executa agora: ${sim.reason}. Nada foi enfileirado — cota de novo.` };
    }

    // Uma ponte nossa vencida no nonce atual? A nova entra no lugar dela.
    const nonce = await bridgeNonce(safe);
    const res = await proposeSafeBatch({
      chainId: ARBITRUM,
      safe,
      calls: quote.calls,
      nonce,
      origin: `${auth.label}: ponte de ${Number(quote.sends).toFixed(4)} MOR Arbitrum → Base ${args.via === "oft" ? "(LayerZero OFT)" : "(swaps.pro)"}`,
    });
    if (!res.ok) return res;
    return { ok: true, url: res.url, receives: quote.receives, provider: quote.provider, deadline: quote.deadline, replaced: nonce !== undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor a ponte." };
  }
}

/** Relê saldos e estado — para ver a ponte chegar na Base sem recarregar a página. */
export async function refreshBridgeContext(args: { safe: string }): Promise<{ ok: true; ctx: BridgeContext } | { ok: false; error: string }> {
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;
  return { ok: true, ctx: await readBridgeContext(getAddress(args.safe)) };
}

/**
 * Monta a ponte para quem vai EXECUTAR direto, com a carteira de um dono —
 * o caminho que cabe na janela da rota do swaps.pro (cotação e execução no
 * mesmo movimento). Não passa pela fila nem pelo proposer: o servidor cota,
 * simula como o Safe e devolve os argumentos de `execTransaction`; a carteira
 * do dono assina e envia. Só faz sentido com threshold 1, e o próprio Safe
 * recusa qualquer um que não seja dono (GS026) — a checagem aqui é para a
 * tela não oferecer o que não vai passar.
 */
export async function buildMorBridgeExec(args: { safe: string; via: "swapspro" | "oft" }): Promise<
  | { ok: true; exec: { to: string; value: string; data: `0x${string}`; operation: 0 | 1 }; receives: string; provider: string; deadline?: number; costEth: string }
  | { ok: false; error: string }
> {
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;
  const safe = getAddress(args.safe);
  try {
    const ctx = await readBridgeContext(safe);
    const amount = BigInt(ctx.morArbWei);
    if (amount <= BigInt(0)) return { ok: false, error: "Não há MOR parado na Arbitrum para este Safe." };
    if (ctx.threshold !== 1) {
      return { ok: false, error: `Este Safe pede ${ctx.threshold ?? "?"} assinaturas na Arbitrum; executar direto só funciona com 1. Use "Propor no Safe".` };
    }
    const quote = args.via === "oft" ? await quoteOft(safe, amount) : await quoteSwapsPro(safe, amount);
    const precisa = quote.calls.reduce((s, c) => s + (c.value ?? BigInt(0)), BigInt(0));
    const ethArb = BigInt(Math.round(Number(ctx.ethArb === "?" ? "0" : ctx.ethArb) * 1e18));
    if (ctx.ethArb !== "?" && ethArb < precisa) {
      return { ok: false, error: `O Safe tem ${ctx.ethArb} ETH na Arbitrum e esta rota precisa de ${quote.costEth}.` };
    }
    const sim = await simulateAsSafe(safe, quote.calls);
    if (!sim.ok) return { ok: false, error: `A rota não executa agora: ${sim.reason}. Cota de novo.` };
    return { ok: true, exec: execParams(quote.calls), receives: quote.receives, provider: quote.provider, deadline: quote.deadline, costEth: quote.costEth };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao montar a ponte." };
  }
}
