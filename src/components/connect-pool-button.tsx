"use client";

import { useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { base } from "viem/chains";
import { Plug, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

// Each payee connects THEIR OWN wallet once to start receiving the stream in
// real time (connectPool must be called by the member — the Safe can't do it
// for them). Client-only tx via the injected wallet; no server, no keys.

const ABI = [
  { name: "connectPool", type: "function", stateMutability: "nonpayable", inputs: [{ name: "pool", type: "address" }, { name: "userData", type: "bytes" }], outputs: [{ type: "bool" }] },
] as const;

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export function ConnectPoolButton({
  pool,
  forwarder,
  connectedAddresses = [],
}: {
  pool: string;
  forwarder: string;
  /** Addresses already connected to the pool (lowercased) — hide the prompt for them. */
  connectedAddresses?: string[];
}) {
  const t = useT().treasury;
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  // A carteira do portal já lê em silêncio (eth_accounts, sem popup) quem
  // autorizou este site. Aqui isso serve para uma coisa só: se quem está
  // olhando JÁ está conectado ao pool, este card inteiro é ruído — some.
  const { address: mine, connect: connectWallet, ensureChain } = useWallet();
  const selfConnected =
    !!mine && connectedAddresses.some((a) => a.toLowerCase() === mine);

  // Already connected (this session or a prior one) → nothing to prompt.
  if (selfConnected && status !== "done") return null;

  async function connect() {
    setStatus("working");
    setMsg(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error(t.wallet.none);
      const conta = await connectWallet();
      if (!conta) throw new Error(t.wallet.none);
      const account = getAddress(conta);
      await ensureChain("0x2105");

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
      setMsg(err.shortMessage ?? err.message ?? t.wallet.failed);
      setStatus("error");
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Plug className="h-4 w-4 text-accent" /> {t.pool.connectTitle}
      </h2>
      <p className="mt-1.5 max-w-xl text-xs text-foreground-subtle">
        {rich(t.pool.connectBody)}
      </p>

      {status === "done" ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> {t.pool.connected}
          {tx && (
            <a href={`https://basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {t.wallet.seeTx} <ExternalLink className="h-3 w-3" />
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
          {t.wallet.connectMine}
        </button>
      )}
      {status === "error" && msg && <p className="mt-2 text-[11px] text-danger">{msg}</p>}
    </section>
  );
}
