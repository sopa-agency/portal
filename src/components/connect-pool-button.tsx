"use client";

import { useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { base } from "viem/chains";
import { Plug, Loader2, CheckCircle2, ExternalLink } from "lucide-react";

// Each payee connects THEIR OWN wallet once to start receiving the stream in
// real time (connectPool must be called by the member — the Safe can't do it
// for them). Client-only tx via the injected wallet; no server, no keys.

const ABI = [
  { name: "connectPool", type: "function", stateMutability: "nonpayable", inputs: [{ name: "pool", type: "address" }, { name: "userData", type: "bytes" }], outputs: [{ type: "bool" }] },
] as const;

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export function ConnectPoolButton({ pool, forwarder }: { pool: string; forwarder: string }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  async function connect() {
    setStatus("working");
    setMsg(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error("Nenhuma carteira detectada. Instale MetaMask/Rabby e recarregue.");
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const account = getAddress(accounts[0]);

      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      if (cid !== "0x2105") {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
        } catch (e) {
          if ((e as { code?: number })?.code === 4902) {
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
            });
          } else throw e;
        }
      }

      const wallet = createWalletClient({ account, chain: base, transport: custom(eth) });
      const hash = await wallet.writeContract({
        address: getAddress(forwarder),
        abi: ABI,
        functionName: "connectPool",
        args: [getAddress(pool), "0x"],
      });
      setTx(hash);
      setStatus("done");
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setMsg(err.shortMessage ?? err.message ?? "Falhou.");
      setStatus("error");
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Plug className="h-4 w-4 text-accent" /> Conectar na pool
      </h2>
      <p className="mt-1.5 max-w-xl text-xs text-foreground-subtle">
        É você que recebe? Conecte <b>sua</b> carteira (a que está na lista de membros) uma vez pra receber o stream em
        tempo real. Sem conectar, sua parte acumula e você resgata depois.
      </p>

      {status === "done" ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> Conectado!
          {tx && (
            <a href={`https://basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              ver tx <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={connect}
          disabled={status === "working"}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
        >
          {status === "working" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          Conectar minha carteira
        </button>
      )}
      {status === "error" && msg && <p className="mt-2 text-[11px] text-danger">{msg}</p>}
    </section>
  );
}
