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

import { createPublicClient, encodeAbiParameters, encodeFunctionData, erc20Abi, fallback, formatEther, formatUnits, getAddress, http, keccak256, pad, parseAbi } from "viem";
import { arbitrum, base as baseChain } from "viem/chains";
import { MULTISEND_CALL_ONLY, encodeMultiSend, proposerAddress, type SafeCall } from "@/lib/safe-propose";
import { safeTxService } from "@/lib/safe-tx";

export const ARBITRUM = 42161;
export const MOR_ARB = getAddress("0x092bAaDB7DEf4C3981454dD9c0A0D7FF07bCFc86");
export const MOR_BASE = getAddress("0x7431aDa8a591C955a994a21710752EF9b882b8e3");
/** EID da Base no LayerZero v2 — `peers(30184)` do MOR na Arbitrum é o MOR da Base. */
const BASE_EID = 30184;

const arb = createPublicClient({
  chain: arbitrum,
  transport: fallback(["https://arbitrum-one-rpc.publicnode.com", "https://gateway.tenderly.co/public/arbitrum"].map((u) => http(u, { timeout: 10_000 }))),
});

const baseClient = createPublicClient({
  chain: baseChain,
  transport: fallback(["https://base-rpc.publicnode.com", "https://mainnet.base.org"].map((u) => http(u, { timeout: 10_000 }))),
});

const MAINNET_RPCS = ["https://gateway.tenderly.co/public/mainnet", "https://ethereum-rpc.publicnode.com"];

const safeReadAbi = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);

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
  /**
   * O proposer do portal está registrado como delegate deste Safe no serviço
   * da Arbitrum? Sem isso nenhuma proposta entra lá. `null` = não deu para
   * ler (o serviço limita por IP) — a tela oferece o registro mesmo assim.
   */
  delegateOk: boolean | null;
  /** O endereço que precisa estar registrado — o do SAFE_PROPOSER_PRIVATE_KEY. */
  delegate: string | null;
  /** MOR do Safe na Base — para ver a ponte chegar. */
  morBase: string;
  /**
   * O Safe NA ARBITRUM: threshold e donos. Com threshold 1, um dono conectado
   * ao portal executa direto, sem fila — é o que faz a rota do swaps.pro
   * caber na janela dela. Os Safes lá estão na configuração do dia zero
   * (SOPA 1-de-3, SkateHive 1-de-2, em 14/09/2026).
   */
  threshold: number | null;
  owners: string[];
};

/** Lê no serviço da Arbitrum se o proposer já é delegate do Safe. */
export async function hasArbitrumDelegate(safe: string): Promise<boolean | null> {
  const delegate = proposerAddress();
  if (!delegate) return null;
  try {
    const r = await fetch(`${safeTxService(ARBITRUM)}/api/v2/delegates/?safe=${getAddress(safe)}&delegate=${delegate}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: { delegate: string }[] };
    return (j.results ?? []).some((d) => d.delegate.toLowerCase() === delegate.toLowerCase());
  } catch {
    return null;
  }
}

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
  const [mor, ethA, ethM, delegateOk, morB, threshold, owners] = await Promise.all([
    arb.readContract({ address: MOR_ARB, abi: erc20Abi, functionName: "balanceOf", args: [owner] }).catch(() => null),
    arb.getBalance({ address: owner }).catch(() => null),
    ethBalanceMainnet(owner),
    hasArbitrumDelegate(owner),
    baseClient.readContract({ address: MOR_BASE, abi: erc20Abi, functionName: "balanceOf", args: [owner] }).catch(() => null),
    arb.readContract({ address: owner, abi: safeReadAbi, functionName: "getThreshold" }).catch(() => null),
    arb.readContract({ address: owner, abi: safeReadAbi, functionName: "getOwners" }).catch(() => null),
  ]);
  const fmt = (wei: bigint | null, d = 5) => (wei == null ? "?" : Number(formatEther(wei)).toFixed(d));
  return {
    morArb: mor == null ? "?" : Number(formatUnits(mor, 18)).toFixed(4),
    morArbWei: (mor ?? BigInt(0)).toString(),
    ethArb: fmt(ethA),
    ethMain: fmt(ethM),
    claimsLeft: ethM == null ? -1 : Math.floor(Number(formatEther(ethM)) / CLAIM_FEE_EST_ETH),
    delegateOk,
    delegate: proposerAddress(),
    morBase: morB == null ? "?" : Number(formatUnits(morB, 18)).toFixed(4),
    threshold: threshold == null ? null : Number(threshold),
    owners: (owners ?? []).map((o) => o.toLowerCase()),
  };
}

/**
 * Os argumentos de `execTransaction` para estas chamadas: uma só vai direta
 * (CALL, com o value dela); mais de uma vai pelo MultiSendCallOnly por
 * DELEGATECALL, e o value de cada uma sai do saldo do Safe dentro do batch.
 * É exatamente o que `proposeSafeBatch` enfileira — aqui, para quem executa.
 */
export function execParams(calls: SafeCall[]): { to: string; value: string; data: `0x${string}`; operation: 0 | 1 } {
  if (calls.length === 1) {
    return { to: getAddress(calls[0].to), value: (calls[0].value ?? BigInt(0)).toString(), data: calls[0].data, operation: 0 };
  }
  return {
    to: MULTISEND_CALL_ONLY,
    value: "0",
    data: encodeFunctionData({ abi: MULTISEND_ABI_MIN, functionName: "multiSend", args: [encodeMultiSend(calls)] }),
    operation: 1,
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
  /**
   * Prazo ON-CHAIN da rota, em segundos unix — depois dele a execução reverte.
   * O `expiresAt` do swaps.pro é a validade do preço (um minuto); o que decide
   * se a transação passa é o deadline dentro do calldata (~30 min, medido em
   * 14/09/2026: uma proposta às 17:17 reverteu com GS013 quando assinada
   * depois das 17:47). O OFT não tem prazo.
   */
  deadline?: number;
};

/**
 * Procura um prazo dentro do calldata: qualquer palavra alinhada (uint256)
 * ou uint32/uint64 desalinhado que pareça um timestamp entre agora e dois
 * dias. Heurística, e assumida como tal: a LI.FI monta o calldata de cada
 * venue de um jeito, e a gente não vai manter um decodificador por venue
 * para ler um número. Devolve o MENOR prazo achado, ou undefined.
 */
export function findCalldataDeadline(data: string, now = Math.floor(Date.now() / 1000)): number | undefined {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const lo = now - 60;
  const hi = now + 2 * 86_400;
  let best: number | undefined;
  const consider = (n: number) => {
    if (n > lo && n < hi && (best === undefined || n < best)) best = n;
  };
  // palavras alinhadas de 32 bytes (uint256)
  for (let i = 8; i + 64 <= hex.length; i += 64) {
    const w = hex.slice(i, i + 64);
    if (/^0{48}[0-9a-f]{16}$/.test(w)) consider(parseInt(w.slice(48), 16));
  }
  // uint32 desalinhado, precedido de zeros (como a Mayan empacota o prazo)
  const re = /0{8}([0-9a-f]{8})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hex))) consider(parseInt(m[1], 16));
  return best;
}

/**
 * O nonce para propor a ponte. Se a única coisa pendente no nonce atual do
 * Safe for uma ponte NOSSA (cotação velha que ninguém assinou a tempo), a
 * nova proposta entra NO MESMO nonce e a substitui — o Safe{Wallet} mostra as
 * duas como conflitantes e a que executar mata a outra. Sem isto cada nova
 * cotação empilhava atrás da anterior, e a anterior, vencida, travava a fila.
 * Qualquer outra coisa pendente (um pagamento, uma rejeição) → nonce normal.
 */
export async function bridgeNonce(safe: string): Promise<number | undefined> {
  const tx = safeTxService(ARBITRUM);
  const addr = getAddress(safe);
  try {
    const info = (await (await fetch(`${tx}/api/v1/safes/${addr}/`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" })).json()) as { nonce?: number | string };
    const onchain = Number(info.nonce ?? NaN);
    if (!Number.isFinite(onchain)) return undefined;
    const q = (await (await fetch(`${tx}/api/v2/safes/${addr}/multisig-transactions/?executed=false&nonce=${onchain}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" })).json()) as { results?: { origin?: string | null }[] };
    const pend = q.results ?? [];
    if (pend.length === 0) return undefined;
    return pend.every((t) => (t.origin ?? "").includes("ponte de")) ? onchain : undefined;
  } catch {
    return undefined;
  }
}

const SIM_RPCS = ["https://gateway.tenderly.co/public/arbitrum", "https://arbitrum.drpc.org"];

/**
 * Executa as chamadas EXATAMENTE como o Safe vai executar, sem assinatura:
 * com o código do MultiSendCallOnly forjado no endereço do Safe (state
 * override), um eth_call ao Safe roda o batch em ordem e cada CALL interno
 * sai do Safe — approve primeiro, ponte depois, com o saldo real de ETH e MOR.
 * Uma chamada só vai direto. Devolve o motivo do revert quando há.
 *
 * Existe porque a fila do Safe aceita qualquer coisa: a proposta de 17:46 de
 * 14/09 entrou, ninguém conseguiu executá-la, e o erro só apareceu na cara de
 * quem foi assinar (GS013, que não explica nada). Simular antes é a diferença
 * entre "não dá agora, cota de novo" e uma proposta morta na fila.
 */
export async function simulateAsSafe(safe: string, calls: SafeCall[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  const owner = getAddress(safe);
  const value = calls.reduce((s, c) => s + (c.value ?? BigInt(0)), BigInt(0));
  const single = calls.length === 1;
  let lastErr = "sem resposta dos RPCs";
  for (const rpc of SIM_RPCS) {
    try {
      const overrides: Record<string, unknown> = {};
      if (!single) {
        const code = await jsonRpc(rpc, "eth_getCode", [MULTISEND_CALL_ONLY, "latest"]);
        if (typeof code !== "string" || code.length < 10) continue;
        overrides[owner] = { code };
      }
      const call = single
        ? { from: owner, to: getAddress(calls[0].to), data: calls[0].data, value: "0x" + value.toString(16) }
        : { from: owner, to: owner, data: encodeFunctionData({ abi: MULTISEND_ABI_MIN, functionName: "multiSend", args: [encodeMultiSend(calls)] }), value: "0x" + value.toString(16) };
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: single ? [call, "latest"] : [call, "latest", overrides] }),
      });
      const j = (await r.json()) as { result?: string; error?: { message?: string; data?: string } };
      if (j.result !== undefined) return { ok: true };
      if (j.error) {
        const msg = j.error.message ?? "";
        // "método não suportado" / "override" = este RPC não simula; tenta o próximo.
        if (/override|not supported|unknown field|invalid argument/i.test(msg) && !/reverted/i.test(msg)) {
          lastErr = msg;
          continue;
        }
        let reason = revertReason(j.error.data) || msg.replace(/^execution reverted:?\s*/i, "");
        // O MultiSend engole o motivo do CALL interno (reverte com data vazio).
        // Para dizer POR QUE, roda só a última chamada com o allowance do MOR
        // forjado — slot 6 do contrato do MOR na Arbitrum, medido em 14/09/2026.
        if (!reason && !single) reason = await reasonOfLastCall(rpc, owner, calls);
        return { ok: false, reason: reason || "reverteu sem motivo" };
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, reason: `não consegui simular (${lastErr.slice(0, 80)})` };
}

async function reasonOfLastCall(rpc: string, owner: string, calls: SafeCall[]): Promise<string> {
  try {
    const last = calls[calls.length - 1];
    const spender = getAddress(last.to);
    const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner as `0x${string}`, BigInt(6)]));
    const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, inner]));
    const amount = "0x" + BigInt("0xffffffffffffffffffffffffffffffff").toString(16).padStart(64, "0");
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ from: owner, to: spender, data: last.data, value: "0x" + (last.value ?? BigInt(0)).toString(16) }, "latest", { [MOR_ARB]: { stateDiff: { [slot]: amount } } }],
      }),
    });
    const j = (await r.json()) as { result?: string; error?: { message?: string; data?: string } };
    if (j.result !== undefined) return "";
    return revertReason(j.error?.data) || (j.error?.message ?? "").replace(/^execution reverted:?\s*/i, "");
  } catch {
    return "";
  }
}

const MULTISEND_ABI_MIN = [
  { name: "multiSend", type: "function", stateMutability: "payable", inputs: [{ name: "transactions", type: "bytes" }], outputs: [] },
] as const;

async function jsonRpc(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown };
  return j.result;
}

/** `Error(string)` do revert, quando vem; senão o seletor cru, que ao menos identifica. */
function revertReason(data?: string): string {
  if (!data || data === "0x") return "";
  if (data.startsWith("0x08c379a0")) {
    try {
      const len = parseInt(data.slice(74, 138), 16);
      return Buffer.from(data.slice(138, 138 + len * 2), "hex").toString("utf8");
    } catch {
      return "";
    }
  }
  return `erro ${data.slice(0, 10)}`;
}

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
    // 3%, não o 1% padrão. Em 14/09/2026 uma proposta cotada a 1% morreu em
    // NOVE minutos ("Return amount is not enough"): o MOR anda mais que isso
    // entre propor e assinar. O piso cai uns 2 pontos; numa ponte de US$ 5 são
    // dez centavos de garantia a menos, contra uma proposta que não executa.
    slippage: "3",
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
    deadline: findCalldataDeadline(j.tx.data),
  };
}
