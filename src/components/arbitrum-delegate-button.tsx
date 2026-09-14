"use client";

// Registra o proposer do portal como delegate do Safe na Arbitrum, com uma
// assinatura da carteira de um dono — sem transação, sem gás.
//
// O fluxo é: conectar → o servidor monta a mensagem EIP-712 (com o endereço
// do proposer, que só ele conhece) → a carteira assina → o servidor entrega ao
// serviço do Safe. A chave nunca passa por aqui; o que passa é a assinatura,
// que só serve para isto e morre em duas horas.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { arbitrumDelegateTypedData, registerArbitrumDelegate } from "@/app/actions/safe-delegate";
import { useWallet } from "@/components/wallet-provider";
import { useLocale } from "@/components/locale-provider";

type Eth = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ArbitrumDelegateButton({ safe, delegate, onDone }: { safe: string; delegate: string; onDone: () => void }) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.bridge;
  const { address, connect, ensureChain, available } = useWallet();
  const [fase, setFase] = useState<"idle" | "connecting" | "signing" | "sending" | "done">("idle");
  const [erro, setErro] = useState<string | null>(null);
  const [quem, setQuem] = useState<string | null>(null);

  async function run() {
    setErro(null);
    try {
      setFase("connecting");
      const conta = address ?? (await connect());
      if (!conta) throw new Error("Sem carteira conectada.");
      // Assinar typed data não exige estar na Arbitrum (o chainId vai no
      // domínio), mas algumas carteiras recusam domínio de outra rede. Tentar
      // trocar é barato; se a carteira não tiver a rede, seguir mesmo assim.
      await ensureChain("0xa4b1").catch(() => {});

      const td = await arbitrumDelegateTypedData({ safe });
      if (!td.ok) throw new Error(td.error);

      setFase("signing");
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error("Carteira não encontrada no navegador.");
      const signature = (await eth.request({
        method: "eth_signTypedData_v4",
        params: [conta, JSON.stringify(td.typedData)],
      })) as string;

      setFase("sending");
      const r = await registerArbitrumDelegate({ safe, delegator: conta, signature, totp: td.totp });
      if (!r.ok) {
        setFase("idle");
        setErro(r.notOwner ? t.delegateNotOwner(short(conta)) : r.error);
        return;
      }
      setQuem(short(conta));
      setFase("done");
      onDone();
    } catch (e) {
      setFase("idle");
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falha ao registrar.";
      setErro(msg.slice(0, 200));
    }
  }

  if (fase === "done") {
    return (
      <p className="flex items-center gap-2 text-[11px] text-success">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {t.delegateDone(quem ?? "")}
      </p>
    );
  }

  const busy = fase !== "idle";
  const rotulo =
    fase === "connecting" ? t.delegateConnecting : fase === "signing" ? t.delegateSigning : fase === "sending" ? t.delegateSending : t.delegateAction;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !available}
        title={available ? undefined : "Nenhuma carteira no navegador"}
        className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
        {rotulo}
      </button>
      <p className="font-mono text-[10px] text-foreground-faint">
        delegate {short(delegate)} · safe {short(safe)}
        {address ? ` · ${short(address)}` : ""}
      </p>
      {erro && (
        <p className="flex items-start gap-2 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {erro}
        </p>
      )}
    </div>
  );
}
