import "server-only";

// A ponte do MOR: Arbitrum → Base.
//
// POR QUE ISTO EXISTE
//
// O claim da capital minta o MOR na ARBITRUM. O restake (Builders) e o swapper
// que vira MOR em USDC vivem na BASE. Entre os dois havia um buraco que só
// fechava com alguém abrindo uma ponte na mão — e o MOR ficava parado na
// Arbitrum, como ficou (2,6 da SOPA e 5,4 da SkateHive em 14/09/2026).
//
// DUAS ROTAS, MEDIDAS EM 14/09/2026
//
// 1. swaps.pro (LI.FI por baixo: MOR→USDC na Arbitrum, Mayan, USDC→MOR na
//    Base). Custo PROPORCIONAL: ~1,5% em US$ 2–3, ~2,3% em US$ 5–10, mais
//    centavos de gás. Garante só um piso (minBuyAmount), ~1% abaixo.
// 2. LayerZero OFT: a própria token é a ponte (peers na Arb e na Base). Custo
//    FIXO: ~0,000103 ETH (US$ 0,26) e a quantia chega exata.
//
// Ponto de virada: uns US$ 12 por envio. A cadência da casa é SEMANAL e por
// organização (US$ 2–3 por ponte), então o swaps.pro é o padrão — e é o teste
// que o Vlad quer fazer com dinheiro de verdade. O OFT fica como alternativa
// para envios maiores. As duas cotações aparecem lado a lado; quem decide vê o
// número.

import { createPublicClient, encodeFunctionData, erc20Abi, fallback, formatEther, formatUnits, getAddress, http, pad, parseAbi } from "viem";
import { arbitrum } from "viem/chains";
import type { SafeCall } from "@/lib/safe-propose";

export const ARBITRUM = 42161;
export const MOR_ARB = getAddress("0x092bAaDB7DEf4C3981454dD9c0A0D7FF07bCFc86");
export const MOR_BASE = getAddress("0x7431aDa8a591C955a994a21710752EF9b882b8e3");
/** EID da Base no LayerZero v2 — `peers(30184)` do MOR na Arbitrum é o MOR da Base. */
const BASE_EID = 30184;

const arb = createPublicClient({
  chain: arbitrum,
  transport: fallback(["https://arbitrum-one-rpc.publicnode.com", "https://gateway.tenderly.co/public/arbitrum"].map((u) => http(u, { timeout: 10_000 }))),
});

const MAINNET_RPCS = ["https://gateway.tenderly.co/public/mainnet", "https://ethereum-rpc.publicnode.com"];

/**
 * Taxa do claim na mainnet, medida em 01/09/2026 (0,0000431 ETH) com a margem
 * de 1,5× que a ação usa. É estimativa para dizer "dá para N claims" — a
 * medição de verdade acontece na hora de propor (`probeClaimFee`).
 */
export const CLAIM_FEE_EST_ETH = 0.0000431 * 1.5;

const oftAbi = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }",
  "struct OFTFeeDetail { int256 feeAmountLD; string description; }",
  "struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }",
  "function quoteSend(SendParam _sendParam, bool _payInLzToken) view returns (MessagingFee)",
  "function quoteOFT(SendParam _sendParam) view returns (OFTLimit, OFTFeeDetail[], OFTReceipt)",
  "function send(SendParam _sendParam, MessagingFee _fee, address _refundAddress) payable",
]);

export type BridgeContext = {
  /** MOR do Safe parado na Arbitrum, em unidades humanas. */
  morArb: string;
  morArbWei: string;
  ethArb: string;
  ethMain: string;
  /** Quantos claims o ETH da mainnet ainda paga, pela estimativa. */
  claimsLeft: number;
};

async function ethBalanceMainnet(addr: string): Promise<bigint | null> {
  for (const rpc of MAINNET_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
      });
      const j = (await r.json()) as { result?: string };
      if (j.result) return BigInt(j.result);
    } catch {
      // próximo
    }
  }
  return null;
}

/** O que o painel precisa saber antes de qualquer clique. Nunca lança: uma leitura que falha vira "?" na tela, não um painel que some. */
export async function readBridgeContext(safe: string): Promise<BridgeContext> {
  const owner = getAddress(safe);
  const [mor, ethA, ethM] = await Promise.all([
    arb.readContract({ address: MOR_ARB, abi: erc20Abi, functionName: "balanceOf", args: [owner] }).catch(() => null),
    arb.getBalance({ address: owner }).catch(() => null),
    ethBalanceMainnet(owner),
  ]);
  const fmt = (wei: bigint | null, d = 5) => (wei == null ? "?" : Number(formatEther(wei)).toFixed(d));
  return {
    morArb: mor == null ? "?" : Number(formatUnits(mor, 18)).toFixed(4),
    morArbWei: (mor ?? BigInt(0)).toString(),
    ethArb: fmt(ethA),
    ethMain: fmt(ethM),
    claimsLeft: ethM == null ? -1 : Math.floor(Number(formatEther(ethM)) / CLAIM_FEE_EST_ETH),
  };
}

export type BridgeQuote = {
  via: "swapspro" | "oft";
  /** Quantias em unidades humanas, para a tela. */
  sends: string;
  receives: string;
  /** O que o contrato garante; no OFT é igual ao recebido. */
  floor: string;
  /** Custo em ETH pago pelo Safe além da perda de câmbio (OFT: taxa LZ). */
  costEth: string;
  /** Perda de câmbio em MOR (swaps.pro); 0 no OFT. */
  lossMor: string;
  /** As chamadas que o Safe faz, prontas para propor. */
  calls: SafeCall[];
  /** Onde a proposta aponta (para o rótulo da fila). */
  provider: string;
  expiresAt?: string;
};

/**
 * Rota 2: o OFT. `quoteOFT` com minAmountLD = amount REVERTE (SlippageExceeded)
 * porque o OFT apara para 6 casas — cota com min 0 e usa o que ele diz que
 * chega. `enforcedOptions` já cobre o gás do lzReceive, então extraOptions vazio.
 */
export async function quoteOft(safe: string, amountWei: bigint): Promise<BridgeQuote> {
  const owner = getAddress(safe);
  const base = { dstEid: BASE_EID, to: pad(owner, { size: 32 }), amountLD: amountWei, minAmountLD: BigInt(0), extraOptions: "0x" as const, composeMsg: "0x" as const, oftCmd: "0x" as const };
  const [, , receipt] = await arb.readContract({ address: MOR_ARB, abi: oftAbi, functionName: "quoteOFT", args: [base] });
  const sendParam = { ...base, minAmountLD: receipt.amountReceivedLD };
  const fee = await arb.readContract({ address: MOR_ARB, abi: oftAbi, functionName: "quoteSend", args: [sendParam, false] });
  // A taxa anda com o gás entre propor e assinar. 1,2× de folga; o excesso
  // volta para o Safe (refundAddress) na própria transação.
  const value = (fee.nativeFee * BigInt(12)) / BigInt(10);
  const data = encodeFunctionData({ abi: oftAbi, functionName: "send", args: [sendParam, { nativeFee: value, lzTokenFee: BigInt(0) }, owner] });
  return {
    via: "oft",
    sends: formatUnits(amountWei, 18),
    receives: formatUnits(receipt.amountReceivedLD, 18),
    floor: formatUnits(receipt.amountReceivedLD, 18),
    costEth: formatEther(value),
    lossMor: "0",
    calls: [{ to: MOR_ARB, data, value }],
    provider: "LayerZero OFT",
  };
}

type SwapsProQuote = {
  provider?: string;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  expiresAt?: string;
  tx?: { to: string; data: `0x${string}`; value?: string; gasLimit?: string };
  approval?: { to: string; data: `0x${string}` } | null;
  error?: { message?: string };
  message?: string;
};

/**
 * Rota 1: swaps.pro. A API devolve a transação pronta com o Safe como
 * remetente e destinatário (recipient é obrigatório em rota cross-chain).
 * A venda é de ERC-20, então o roteador precisa de allowance: a cotação traz
 * `approval` quando sabe que falta; quando não traz, a gente confere na cadeia
 * — propor sem o approve é enfileirar um revert para alguém assinar.
 */
export async function quoteSwapsPro(safe: string, amountWei: bigint): Promise<BridgeQuote> {
  const owner = getAddress(safe);
  const human = formatUnits(amountWei, 18);
  const q = new URLSearchParams({
    sellChain: String(ARBITRUM),
    sellToken: MOR_ARB,
    buyChain: "8453",
    buyToken: MOR_BASE,
    amount: human,
    address: owner,
    recipient: owner,
    partner: "sopa-portal",
  });
  const r = await fetch(`https://www.swaps.pro/api/sdk/v1/quote?${q}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as SwapsProQuote;
  if (!r.ok || !j.tx?.to || !j.tx.data) {
    throw new Error(j.error?.message ?? j.message ?? `swaps.pro HTTP ${r.status}`);
  }
  const to = getAddress(j.tx.to);
  const calls: SafeCall[] = [];
  if (j.approval?.to && j.approval.data) {
    calls.push({ to: getAddress(j.approval.to), data: j.approval.data });
  } else {
    const allowance = await arb.readContract({ address: MOR_ARB, abi: erc20Abi, functionName: "allowance", args: [owner, to] });
    if (allowance < amountWei) {
      calls.push({ to: MOR_ARB, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [to, amountWei] }) });
    }
  }
  const value = j.tx.value && j.tx.value !== "0x0" && j.tx.value !== "0" ? BigInt(j.tx.value) : BigInt(0);
  calls.push({ to, data: j.tx.data, value });
  const sells = Number(j.sellAmount ?? human);
  const buys = Number(j.buyAmount ?? 0);
  return {
    via: "swapspro",
    sends: j.sellAmount ?? human,
    receives: j.buyAmount ?? "0",
    floor: j.minBuyAmount ?? "0",
    costEth: formatEther(value),
    lossMor: Math.max(0, sells - buys).toFixed(6),
    calls,
    provider: `swaps.pro (${j.provider ?? "?"})`,
    expiresAt: j.expiresAt,
  };
}
