"use client";

// ⚠️ TEMPORARY ops panel — deploy + dry-run the SwapperFlashFiller from the
// browser (haxixe.eth signs), then paste the deployed address and test a live
// fill with minOut=0 (principal-safe: the flash reverts if the UniV3 output
// can't cover the swapper's oracle price, so worst case is 0 surplus). Once it
// works live, the real Swap A/B buttons point at the deployed address and this
// panel + src/lib/flash-filler-artifact.ts get deleted. Gated to haxixe.eth.

import { useState } from "react";
import { createPublicClient, http, getAddress, encodeDeployData, encodeFunctionData, isAddress, type Address } from "viem";
import { base } from "viem/chains";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";
import { Loader2, Plug, Rocket, ExternalLink, AlertTriangle, Zap } from "lucide-react";
import { PIPELINE } from "@/lib/mor-pipeline";
import { FLASH_FILLER_ABI, FLASH_FILLER_BYTECODE, FLASH_FILLER_ROUTER, FLASH_FILLER_HOPS } from "@/lib/flash-filler-artifact";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const pub = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const LS_KEY = "sopa.flashFiller.address";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const errMsg = (e: unknown) => (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falha.";
const softParams = (e: unknown) => {
  const code = (e as { code?: number }).code;
  const m = (((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "")).toLowerCase();
  return code === -32602 || m.includes("invalid param");
};

export function NativeSwapDeployPanel() {
  const dict = useT().treasury;
  const t = dict.mor;
  const [account, setAccount] = useState<string | null>(null);
  const [filler, setFiller] = useState<string>(() => (typeof window !== "undefined" ? localStorage.getItem(LS_KEY) ?? "" : ""));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  const isOwner = account != null && account.toLowerCase() === PIPELINE.owner.toLowerCase();
  const fillerOk = isAddress(filler);

  async function connect() {
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error(t.noWalletShort);
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      if (cid !== "0x2105") await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }).catch(() => {});
      setAccount(getAddress(accs[0]));
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  async function deploy() {
    if (!account) return;
    setBusy("deploy"); setErr(null); setLog(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      const from = getAddress(account);
      const data = encodeDeployData({ abi: FLASH_FILLER_ABI, bytecode: FLASH_FILLER_BYTECODE, args: [getAddress(FLASH_FILLER_ROUTER), from] });
      const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, data }] })) as string;
      setLog(`Deploy enviado: ${hash}`);
      if (/^0x[0-9a-f]{64}$/i.test(hash)) {
        const rcpt = await pub.waitForTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => null);
        if (rcpt?.contractAddress) {
          setFiller(rcpt.contractAddress);
          localStorage.setItem(LS_KEY, rcpt.contractAddress);
          setLog(`Deployado em ${rcpt.contractAddress}`);
        } else {
          setLog("Enviado — cole o endereço do contrato (do teu wallet / basescan) abaixo.");
        }
      } else {
        setLog("Enviado (hash de userOp) — cole o endereço do contrato abaixo.");
      }
    } catch (e) {
      if (softParams(e)) setLog(t.softParams);
      else setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function fill(hop: (typeof FLASH_FILLER_HOPS)[keyof typeof FLASH_FILLER_HOPS]) {
    if (!account || !fillerOk) return;
    setBusy(hop.swapper); setErr(null); setLog(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      const from = getAddress(account);
      const data = encodeFunctionData({
        abi: FLASH_FILLER_ABI,
        functionName: "fill",
        args: [getAddress(hop.swapper), getAddress(hop.tokenFromTrader), hop.poolFee, BigInt(0), PIPELINE.sopa as Address],
      });
      const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: getAddress(filler), data }] })) as string;
      setLog(`${hop.label} enviado: ${hash}`);
      if (/^0x[0-9a-f]{64}$/i.test(hash)) await pub.waitForTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => {});
      setLog(`${hop.label} — confere o resultado no basescan.`);
    } catch (e) {
      if (softParams(e)) setLog(t.softParamsHop(hop.label));
      else setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section className="rounded-2xl border border-warning/40 bg-warning/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Zap className="h-4 w-4 text-warning" /> {t.deployTitle}
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">{t.deployTemp}</span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
            {rich(t.deployHint)}
          </p>
        </div>
        {account ? (
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${isOwner ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
            {isOwner ? t.ownerConnected : t.wrongWallet}
          </span>
        ) : (
          <button type="button" onClick={connect} className={`${btn} border border-accent-border bg-accent-bg text-accent hover:bg-accent/20`}>
            <Plug className="h-3.5 w-3.5" /> {t.connectShort}
          </button>
        )}
      </div>

      {isOwner ? (
        <div className="mt-4 space-y-4">
          {/* Step 1 — deploy */}
          <div className="rounded-xl border border-border bg-surface p-3.5">
            <div className="mb-2 text-xs font-semibold text-foreground">{t.deployStep}</div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={deploy} disabled={!!busy} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
                {busy === "deploy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />} {t.deployAction}
              </button>
              <input
                value={filler}
                onChange={(e) => { setFiller(e.target.value.trim()); if (isAddress(e.target.value.trim())) localStorage.setItem(LS_KEY, e.target.value.trim()); }}
                placeholder={t.fillerPlaceholder}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2.5 py-2 font-mono text-[11px] text-foreground placeholder:text-foreground-faint"
              />
              {fillerOk && (
                <a href={`https://basescan.org/address/${filler}`} target="_blank" rel="noopener noreferrer" className={`${btn} border border-border bg-surface-elevated text-foreground-muted hover:text-foreground`}>
                  {short(filler)} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          {/* Step 2 — dry-run fills */}
          <div className="rounded-xl border border-border bg-surface p-3.5">
            <div className="mb-2 text-xs font-semibold text-foreground">{t.fillStep}</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FLASH_FILLER_HOPS).map(([k, hop]) => (
                <button key={k} type="button" onClick={() => fill(hop)} disabled={!!busy || !fillerOk} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
                  {busy === hop.swapper ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} {t.fill(hop.label)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-foreground-faint">{t.fillNote(short(PIPELINE.sopa))}</p>
          </div>

          {log && <p className="rounded-lg border border-border bg-surface-elevated px-3 py-2 font-mono text-[11px] text-foreground-muted break-all">{log}</p>}
          {err && <p className="flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{err}</p>}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] text-foreground-faint">
          {account ? t.connectOwner : t.connectOwnerIdle}
        </p>
      )}
    </section>
  );
}
