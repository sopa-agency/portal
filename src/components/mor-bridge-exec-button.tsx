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
// dono (GS026), então a checagem de dono aqui é só para não oferecer o botão.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Zap } from "lucide-react";
import { encodeFunctionData, parseAbi } from "viem";
import { buildMorBridgeExec } from "@/app/actions/mor-bridge";
import { useWallet } from "@/components/wallet-provider";
import { useLocale } from "@/components/locale-provider";

type Eth = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

const SAFE_ABI = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const ARB_RPC = "https://arbitrum-one-rpc.publicnode.com";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export function MorBridgeExecButton({
  safe,
  via,
  owners,
  onDone,
}: {
  safe: string;
  via: "swapspro" | "oft";
  owners: string[];
  onDone: (r: { hash: string; receives: string; provider: string; via: "swapspro" | "oft" }) => void;
}) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.bridge;
  const { address, connect, ensureChain, available } = useWallet();
  const [fase, setFase] = useState<"idle" | "connecting" | "building" | "signing" | "mining" | "done" | "reverted">("idle");
  const [erro, setErro] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  async function run() {
    setErro(null);
    try {
      setFase("connecting");
      const conta = address ?? (await connect());
      if (!conta) throw new Error(t.execNoWallet);
      if (!owners.includes(conta.toLowerCase())) throw new Error(t.execNotOwner(short(conta)));
      await ensureChain("0xa4b1");
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error(t.execNoWallet);
      const chain = (await eth.request({ method: "eth_chainId" })) as string;
      if (chain?.toLowerCase() !== "0xa4b1") throw new Error("A carteira não está na Arbitrum.");

      setFase("building");
      const b = await buildMorBridgeExec({ safe, via });
      if (!b.ok) throw new Error(b.error);

      // Assinatura pré-validada: o remetente é dono, e o Safe confere isso.
      const sig = (`0x${conta.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}01`) as `0x${string}`;
      const data = encodeFunctionData({
        abi: SAFE_ABI,
        functionName: "execTransaction",
        args: [b.exec.to as `0x${string}`, BigInt(b.exec.value), b.exec.data, b.exec.operation, BigInt(0), BigInt(0), BigInt(0), ZERO, ZERO, sig],
      });

      setFase("signing");
      const h = (await eth.request({ method: "eth_sendTransaction", params: [{ from: conta, to: safe, data, value: "0x0" }] })) as string;
      setHash(h);
      setFase("mining");
      const rc = await receipt(h);
      if (rc && rc.status === "0x1") {
        setFase("done");
        onDone({ hash: h, receives: b.receives, provider: b.provider, via });
      } else if (rc) {
        setFase("reverted");
      } else {
        setFase("done"); // sem recibo em 3 min: a tela mostra o hash e a pessoa confere no explorer
        onDone({ hash: h, receives: b.receives, provider: b.provider, via });
      }
    } catch (e) {
      setFase("idle");
      const code = (e as { code?: number }).code;
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "";
      setErro(code === 4001 || /reject|denied/i.test(msg) ? "Cancelado na carteira." : msg.slice(0, 220));
    }
  }

  if (fase === "done" && hash) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-success">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {t.execDone}
        <a href={`https://arbiscan.io/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
          {t.onArbiscan} <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    );
  }
  if (fase === "reverted" && hash) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t.execFailed}
        <a href={`https://arbiscan.io/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
          {t.onArbiscan} <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    );
  }

  const busy = fase !== "idle";
  const rotulo =
    fase === "connecting" ? t.execConnecting : fase === "building" ? t.execBuilding : fase === "signing" ? t.execSigning : fase === "mining" ? t.execMining : t.execNow;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !available}
        title={available ? undefined : t.execNoWallet}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        {rotulo}
      </button>
      {erro && (
        <p className="flex items-start gap-2 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {erro}
        </p>
      )}
    </div>
  );
}
