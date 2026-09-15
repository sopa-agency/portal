"use client";

// Executa a ponte AGORA, com a carteira de um dono do Safe na Arbitrum.
//
// Por que existe: a rota do swaps.pro (LI.FI) para MOR morre em minutos — em
// 14/09/2026 três propostas reais passaram na hora e reverteram entre seis e
// dez minutos depois, antes de alguém chegar à fila do Safe para assinar.
// Cotar e executar precisam ser o mesmo movimento. Como os Safes na Arbitrum
// pedem UMA assinatura, a carteira do dono conectada aqui resolve: o servidor
// cota e simula, a carteira assina o `execTransaction` e manda.
//
// A assinatura é a "pré-validada" do Safe: r = o próprio remetente, s = 0,
// v = 1. O Safe aceita porque msg.sender é dono. Nada de chave no servidor,
// nada de fila, nada de delegate — e o próprio contrato recusa quem não é
// dono (GS026), então a checagem de dono aqui é só para não tentar à toa.

import { encodeFunctionData, parseAbi } from "viem";
import { buildMorBridgeExec } from "@/app/actions/mor-bridge";

type Eth = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

const SAFE_ABI = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const ARB_RPC = "https://arbitrum-one-rpc.publicnode.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ExecFase = "connecting" | "building" | "signing" | "mining";

async function receipt(hash: string): Promise<{ status: string } | null> {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(ARB_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
      });
      const j = (await r.json()) as { result?: { status: string } | null };
      if (j.result) return j.result;
    } catch {
      // tenta de novo
    }
    await sleep(2000);
  }
  return null;
}

/**
 * Cota, simula, assina e envia. Lança com a mensagem já legível; devolve o
 * hash e o que a rota entrega. `onFase` deixa a tela contar a história.
 */
export async function runBridgeExec(args: {
  safe: string;
  via: "swapspro" | "oft";
  owners: string[];
  wallet: { address: string | null; connect: () => Promise<string | null>; ensureChain: (hex: string) => Promise<void> };
  onFase: (f: ExecFase) => void;
  msgs: { noWallet: string; notOwner: (who: string) => string; wrongChain: string };
}): Promise<{ hash: string; receives: string; provider: string; mined: boolean | null }> {
  const { safe, via, owners, wallet, onFase, msgs } = args;
  onFase("connecting");
  const conta = wallet.address ?? (await wallet.connect());
  if (!conta) throw new Error(msgs.noWallet);
  if (!owners.includes(conta.toLowerCase())) throw new Error(msgs.notOwner(`${conta.slice(0, 6)}…${conta.slice(-4)}`));
  await wallet.ensureChain("0xa4b1");
  const eth = (window as unknown as { ethereum?: Eth }).ethereum;
  if (!eth) throw new Error(msgs.noWallet);
  const chain = (await eth.request({ method: "eth_chainId" })) as string;
  if (chain?.toLowerCase() !== "0xa4b1") throw new Error(msgs.wrongChain);

  onFase("building");
  const b = await buildMorBridgeExec({ safe, via });
  if (!b.ok) throw new Error(b.error);

  const sig = `0x${conta.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}01` as `0x${string}`;
  const data = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [b.exec.to as `0x${string}`, BigInt(b.exec.value), b.exec.data, b.exec.operation, BigInt(0), BigInt(0), BigInt(0), ZERO, ZERO, sig],
  });

  onFase("signing");
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from: conta, to: safe, data, value: "0x0" }] })) as string;
  onFase("mining");
  const rc = await receipt(hash);
  return { hash, receives: b.receives, provider: b.provider, mined: rc ? rc.status === "0x1" : null };
}
