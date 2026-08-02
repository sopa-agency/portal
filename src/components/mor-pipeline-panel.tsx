"use client";

// Owner-only cockpit for the Gnars MOR → USDC pipeline (Base). Shows where funds
// currently sit across the 0xSplits + swapper chain and lets haxixe.eth drive the
// flow: Claim → Advance MOR (distribute + withdraws) → Swap A/B → Advance USDC.
// Only haxixe.eth can run it (the pipeline owner). The two swaps are owner-gated
// and route through the proven Splits "swap funds" UI; the split hops (permission-
// less) run natively here via the injected wallet. Reads refresh after each step.

import { useState } from "react";
import { createPublicClient, http, getAddress, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle, Plug } from "lucide-react";
import {
  PIPELINE, TOKENS, TOP_SPLIT_STRUCT, DOWNSTREAM_SPLIT_STRUCT, pipelineAbis,
  getPipelineStatus, type PipelineStatus,
} from "@/lib/mor-pipeline";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const pub = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const splitsUrl = (addr: string) => `https://explorer.splits.org/accounts/${addr}/?chainId=8453`;
const mor = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 3 : 6 })} MOR`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function MorPipelinePanel({ initial }: { initial: PipelineStatus }) {
  const [status, setStatus] = useState<PipelineStatus>(initial);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isOwner = account != null && account.toLowerCase() === PIPELINE.owner.toLowerCase();

  async function connect() {
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error("No wallet detected. Install MetaMask/Rabby and reload.");
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      if (cid !== "0x2105") {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }).catch(async (e) => {
          if ((e as { code?: number })?.code === 4902) {
            await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }] });
          } else throw e;
        });
      }
      setAccount(getAddress(accs[0]));
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Connect failed.");
    }
  }

  const refresh = () => getPipelineStatus().then(setStatus).catch(() => {});

  // Run a sequence of writes (each awaited to receipt), then refresh status.
  async function run(id: string, calls: { address: string; abi: readonly unknown[]; fn: string; args: readonly unknown[] }[]) {
    if (!account) return;
    setBusy(id);
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      const from = getAddress(account);
      // Send a raw eth_sendTransaction ({from,to,data}) and let the wallet fill
      // gas/fees/nonce — most compatible with injected wallets (viem's writeContract
      // adds fields some wallet RPCs reject, esp. for a 7702-delegated EOA).
      for (const c of calls) {
        const data = encodeFunctionData({ abi: c.abi, functionName: c.fn, args: c.args } as Parameters<typeof encodeFunctionData>[0]);
        const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: getAddress(c.address), data }] })) as `0x${string}`;
        await pub.waitForTransactionReceipt({ hash });
      }
      await refresh();
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Transaction failed.");
    } finally {
      setBusy(null);
    }
  }

  const acct = account ? getAddress(account) : PIPELINE.owner;
  const claim = () => run("claim", [{ address: PIPELINE.builders, abi: pipelineAbis.builders, fn: "claim", args: [PIPELINE.subnetId, PIPELINE.topSplit] }]);
  const advanceMor = () => run("mor", [
    { address: PIPELINE.topSplit, abi: pipelineAbis.split, fn: "distribute", args: [TOP_SPLIT_STRUCT, TOKENS.mor.address, acct] },
    { address: PIPELINE.warehouse, abi: pipelineAbis.warehouse, fn: "withdraw", args: [PIPELINE.swapperA, TOKENS.mor.address] },
    { address: PIPELINE.warehouse, abi: pipelineAbis.warehouse, fn: "withdraw", args: [PIPELINE.sopa, TOKENS.mor.address] },
  ]);
  const advanceUsdc = () => run("usdc", [
    { address: PIPELINE.downstreamSplit, abi: pipelineAbis.split, fn: "distribute", args: [DOWNSTREAM_SPLIT_STRUCT, TOKENS.usdc.address, acct] },
    { address: PIPELINE.warehouse, abi: pipelineAbis.warehouse, fn: "withdraw", args: [PIPELINE.gnarsTreasury, TOKENS.usdc.address] },
    { address: PIPELINE.warehouse, abi: pipelineAbis.warehouse, fn: "withdraw", args: [PIPELINE.sopa, TOKENS.usdc.address] },
  ]);

  const rows: { label: string; value: string; flag?: "warn" | "ok" }[] = [
    { label: "Subnet reward (claimable)", value: mor(status.subnetRewardMor) },
    { label: "Top split — awaiting distribute", value: mor(status.topSplitMor) },
    { label: "Swapper A — needs withdraw", value: mor(status.swapperAWarehouseMor), flag: status.swapperAWarehouseMor > 0 ? "warn" : undefined },
    { label: "Swapper A — ready to swap", value: mor(status.swapperAMor) },
    { label: "Swapper B — ready to swap", value: `${status.swapperBWeth.toLocaleString("en-US", { maximumFractionDigits: 6 })} WETH` },
    { label: "Downstream split — awaiting distribute", value: usd(status.downstreamUsdc) },
    { label: "Gnars — needs withdraw", value: usd(status.gnarsWarehouseUsdc), flag: status.gnarsWarehouseUsdc > 0 ? "warn" : undefined },
    { label: "Gnars Treasury — delivered", value: usd(status.gnarsUsdc), flag: "ok" },
  ];

  const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">MOR → USDC pipeline</h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
            Claim the Gnars subnet&apos;s MOR and route it through the splits + swappers so the Gnars DAO ends up
            holding USDC and SOPA keeps its share. Only <b className="text-foreground">haxixe.eth</b> can run it.
          </p>
        </div>
        {account ? (
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${isOwner ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
            {isOwner ? "owner connected" : "not the owner"}
          </span>
        ) : (
          <button type="button" onClick={connect} className={`${btn} border border-accent-border bg-accent-bg text-accent hover:bg-accent/20`}>
            <Plug className="h-3.5 w-3.5" /> Connect wallet
          </button>
        )}
      </div>

      {/* Status view */}
      <div className="mt-4 divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
              {r.flag === "warn" && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
              {r.flag === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
              {r.label}
            </span>
            <span className={`font-mono text-sm font-semibold tabular-nums ${r.flag === "warn" ? "text-warning" : r.flag === "ok" ? "text-success" : "text-foreground"}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={claim} disabled={!isOwner || !!busy} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
          {busy === "claim" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Claim
        </button>
        <button type="button" onClick={advanceMor} disabled={!isOwner || !!busy} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
          {busy === "mor" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Advance MOR
        </button>
        <a href={splitsUrl(PIPELINE.swapperA)} target="_blank" rel="noopener noreferrer" className={`${btn} border border-border bg-surface-elevated text-foreground-muted hover:text-foreground`}>
          Swap A <ExternalLink className="h-3 w-3" />
        </a>
        <a href={splitsUrl(PIPELINE.swapperB)} target="_blank" rel="noopener noreferrer" className={`${btn} border border-border bg-surface-elevated text-foreground-muted hover:text-foreground`}>
          Swap B <ExternalLink className="h-3 w-3" />
        </a>
        <button type="button" onClick={advanceUsdc} disabled={!isOwner || !!busy} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
          {busy === "usdc" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Advance USDC
        </button>
      </div>

      {err && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
      <p className="mt-3 text-[11px] text-foreground-faint">
        Order: <b>Claim</b> → <b>Advance MOR</b> → <b>Swap A</b> → <b>Swap B</b> → <b>Advance USDC</b>. Claim/Advance run natively
        (distribute + withdraw); the two swaps open the Splits &quot;swap funds&quot; UI (owner-driven, proven path). ⚠️ = funds
        credited in the Warehouse waiting for a withdraw.
      </p>
    </section>
  );
}
