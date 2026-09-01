"use client";

// Owner-only cockpit for the Gnars MOR → USDC pipeline (Base). Shows where funds
// currently sit across the 0xSplits + swapper chain and lets haxixe.eth drive the
// flow: Claim → Advance MOR (distribute + withdraws) → Swap A/B → Advance USDC.
// Only haxixe.eth can run it (the pipeline owner). Non-owners get a read-only
// status view — the action controls only render for the owner wallet. The two
// swaps route through the proven Splits "swap funds" UI; the split hops
// (permissionless) run natively here via the injected wallet. Copy is PT-BR.

import { useState } from "react";
import { createPublicClient, http, getAddress, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle, Plug, RefreshCw, Zap } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import {
  PIPELINE, TOKENS, TOP_SPLIT_STRUCT, DOWNSTREAM_SPLIT_STRUCT, pipelineAbis,
  getPipelineStatus, type PipelineStatus,
} from "@/lib/mor-pipeline";
import { getSwapMinOut } from "@/app/actions/mor-swap";
import { proposeMorRestake } from "@/app/actions/mor-restake";
import { useLocale } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const pub = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const splitsUrl = (addr: string) => `https://explorer.splits.org/accounts/${addr}/?chainId=8453`;
const morIn = (n: number, l: string) => `${n.toLocaleString(l, { maximumFractionDigits: n >= 1 ? 3 : 6 })} MOR`;
const usdIn = (n: number, l: string) => n.toLocaleString(l, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function MorPipelinePanel({ initial }: { initial: PipelineStatus }) {
  const { locale, t: dict } = useLocale();
  const t = dict.treasury.mor;
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";
  const mor = (n: number) => morIn(n, intlLocale);
  const usd = (n: number) => usdIn(n, intlLocale);
  const [status, setStatus] = useState<PipelineStatus>(initial);
  const { address: account, connect: connectWallet, connecting, ensureChain } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Restake = propose (not execute). Server builds the Safe batch and hands back
  // the queue link; a SOPA owner signs it in the Safe UI. No wallet needed here.
  const [restaking, setRestaking] = useState(false);
  const [restake, setRestake] = useState<{ url: string; amount: string } | null>(null);
  const [restakeErr, setRestakeErr] = useState<string | null>(null);

  async function proposeRestake() {
    setRestaking(true);
    setRestakeErr(null);
    setRestake(null);
    try {
      const res = await proposeMorRestake();
      if (res.ok) setRestake({ url: res.url, amount: res.amount });
      else setRestakeErr(res.error);
    } catch {
      setRestakeErr("Falha ao propor o restake.");
    } finally {
      setRestaking(false);
    }
  }

  const isOwner = account != null && account.toLowerCase() === PIPELINE.owner.toLowerCase();
  const connected = account != null;

  async function connect() {
    setErr(null);
    const a = await connectWallet();
    if (a) await ensureChain("0x2105");
  }

  const refresh = () => getPipelineStatus().then(setStatus).catch(() => {});

  // Run a sequence of writes, then refresh status. Smart / 7702-delegated wallets
  // are quirky: some broadcast the tx but still return an "invalid parameters"
  // (-32602) error, and some return a userOp-style hash our public RPC can't
  // resolve as a standard receipt. Neither means failure — only a user rejection
  // (4001) is a real stop. So we soft-handle those and let the on-chain status
  // refresh be the source of truth, instead of showing a scary false error.
  async function run(id: string, calls: { address: string; abi: readonly unknown[]; fn: string; args: readonly unknown[] }[]) {
    if (!account) return;
    setBusy(id);
    setErr(null);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await ensureChain("0x2105");
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      const from = getAddress(account);
      for (const c of calls) {
        const data = encodeFunctionData({ abi: c.abi, functionName: c.fn, args: c.args } as Parameters<typeof encodeFunctionData>[0]);
        let hash: string | undefined;
        try {
          hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: getAddress(c.address), data }] })) as string;
        } catch (e) {
          const code = (e as { code?: number }).code;
          const msg = ((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "").toLowerCase();
          if (code === 4001 || msg.includes("reject") || msg.includes("denied")) throw e; // user said no
          // "invalid parameters" (-32602) from a smart/7702 wallet that likely
          // broadcast anyway — wait for the effect to land, then move on.
          if (code === -32602 || msg.includes("invalid param")) {
            await sleep(8000);
            continue;
          }
          throw e; // a genuine, unexpected failure — surface it
        }
        if (typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)) {
          await pub.waitForTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => sleep(8000));
        } else {
          await sleep(8000); // non-standard (userOp) hash — give it time to land
        }
      }
      await refresh();
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? dict.treasury.wallet.txFailed);
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

  // Native flash-fill via our SwapperFlashFiller — replaces clicking the Splits
  // explorer. Reads a protective minOut from the swapper's oracle (server-side),
  // then fills. Owner-only (the filler is owner-gated to haxixe). The explorer
  // link stays in the UI as a fallback.
  const nativeSwap = async (hop: "A" | "B") => {
    if (!account) return;
    const id = hop === "A" ? "swapA" : "swapB";
    setBusy(id);
    setErr(null);
    const q = await getSwapMinOut(hop).catch(() => null);
    if (!q) { setErr(t.quoteFailed); setBusy(null); return; }
    if (BigInt(q.baseAmount || "0") <= BigInt(1)) {
      setErr(t.swapperEmpty(hop));
      setBusy(null);
      return;
    }
    const cfg = hop === "A"
      ? { swapper: PIPELINE.swapperA, token: TOKENS.mor.address, fee: 3000 }
      : { swapper: PIPELINE.swapperB, token: TOKENS.weth.address, fee: 500 };
    await run(id, [{ address: PIPELINE.filler, abi: pipelineAbis.filler, fn: "fill", args: [cfg.swapper, cfg.token, cfg.fee, BigInt(q.minOut), PIPELINE.sopa] }]);
  };

  const doRefresh = async () => {
    setBusy("refresh");
    await getPipelineStatus().then(setStatus).catch(() => {});
    setBusy(null);
  };

  // USD hints — null when the price feed is down (0) or the amount is dust, so we
  // never show a distracting "$0.00" next to an empty hop.
  const mUsd = (n: number) => (status.morPriceUsd > 0 && n > 0 ? usd(n * status.morPriceUsd) : null);
  const eUsd = (n: number) => (status.ethPriceUsd > 0 && n > 0 ? usd(n * status.ethPriceUsd) : null);

  const rows: { label: string; value: string; sub?: string | null; flag?: "warn" | "ok" }[] = [
    { label: t.rowSubnetReward, value: mor(status.subnetRewardMor), sub: mUsd(status.subnetRewardMor) },
    { label: t.rowTopSplit, value: mor(status.topSplitMor), sub: mUsd(status.topSplitMor) },
    { label: t.rowSwapperAWarehouse, value: mor(status.swapperAWarehouseMor), sub: mUsd(status.swapperAWarehouseMor), flag: status.swapperAWarehouseMor > 0 ? "warn" : undefined },
    { label: t.rowSwapperAReady, value: mor(status.swapperAMor), sub: mUsd(status.swapperAMor) },
    { label: t.rowSwapperBReady, value: `${status.swapperBWeth.toLocaleString(intlLocale, { maximumFractionDigits: 6 })} WETH`, sub: eUsd(status.swapperBWeth) },
    { label: t.rowFinalSplit, value: usd(status.downstreamUsdc) },
    { label: t.rowGnarsWarehouse, value: usd(status.gnarsWarehouseUsdc), flag: status.gnarsWarehouseUsdc > 0 ? "warn" : undefined },
    { label: t.rowGnarsDelivered, value: usd(status.gnarsUsdc), flag: "ok" },
  ];

  // "In flight" = anything sitting between the claim and the final delivery. When
  // it's all zero, nothing is mid-pipeline — say so instead of showing rows of 0.
  const inFlight =
    status.topSplitMor + status.swapperAWarehouseMor + status.swapperAMor +
    status.swapperBWeth + status.downstreamUsdc + status.gnarsWarehouseUsdc;

  // Eligibility guards — the real gate here is "is there anything to do at this
  // hop". Admin subnet-reward claim has no time lock; it just needs reward > 0.
  const EPS_MOR = 0.0001; // dust threshold in MOR
  const EPS_USDC = 0.01; // dust threshold in USDC
  const canClaim = status.subnetRewardMor > EPS_MOR;
  const canAdvanceMor =
    status.topSplitMor + status.swapperAWarehouseMor + status.sopaWarehouseMor > EPS_MOR;
  const canAdvanceUsdc =
    status.downstreamUsdc + status.gnarsWarehouseUsdc + status.sopaWarehouseUsdc > EPS_USDC;

  const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t.pipelineTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
            {rich(t.pipelineHint)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doRefresh} disabled={busy === "refresh"} title={t.refresh} className={`${btn} border border-border bg-surface-elevated text-foreground-muted hover:text-foreground`}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
          </button>
          {account ? (
            <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${isOwner ? "bg-success/15 text-success" : "bg-accent-bg text-accent"}`}>
              {isOwner ? t.ownerConnected : t.canAdvance}
            </span>
          ) : (
            <button type="button" onClick={connect} disabled={connecting} className={`${btn} border border-accent-border bg-accent-bg text-accent hover:bg-accent/20 disabled:opacity-40`}>
              <Plug className="h-3.5 w-3.5" /> {dict.treasury.wallet.connect}
            </button>
          )}
        </div>
      </div>

      {/* Status view (read-only for everyone) */}
      <div className="mt-4 divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
              {r.flag === "warn" && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
              {r.flag === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
              {r.label}
            </span>
            <span className="text-right">
              <span className={`block font-mono text-sm font-semibold tabular-nums ${r.flag === "warn" ? "text-warning" : r.flag === "ok" ? "text-success" : "text-foreground"}`}>{r.value}</span>
              {r.sub && <span className="block font-mono text-[11px] tabular-nums text-foreground-faint">≈ {r.sub}</span>}
            </span>
          </div>
        ))}
      </div>

      {inFlight < 0.001 && (
        <p className="mt-2 text-[11px] text-foreground-faint">
          {t.nothingInFlight}
        </p>
      )}

      {/* Restake da fatia da SOPA (os 10% de MOR). Propõe UM batch pro Safe da SOPA
          — withdraw do Warehouse + approve + deposit na subnet — e devolve o link
          pra assinar. Não executa nada; só enfileira. Sem carteira conectada. */}
      {status.sopaWarehouseMor + status.sopaWalletMor > EPS_MOR && (
        <div className="mt-4 rounded-xl border border-accent-border bg-accent-bg/40 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                Restake da SOPA · {mor(status.sopaWarehouseMor + status.sopaWalletMor)}
              </p>
              <p className="mt-0.5 text-[11px] text-foreground-muted">
                Propõe pro Safe da SOPA: sacar do Warehouse + stake na subnet da Gnars. Você assina no Safe.
              </p>
            </div>
            <button
              type="button"
              onClick={proposeRestake}
              disabled={restaking}
              className={`${btn} border border-accent-border bg-accent-bg text-accent hover:bg-accent/20`}
            >
              {restaking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Restake
            </button>
          </div>
          {restake && (
            <a
              href={restake.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs font-semibold text-success transition hover:bg-success/20"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Proposta criada ({restake.amount} MOR) — assinar no Safe <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {restakeErr && (
            <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">{restakeErr}</p>
          )}
        </div>
      )}

      {/* Controls. Advancing (distribute + withdraw) and the swaps are permissionless
          — any connected wallet can push funds along; only Reivindicar (the admin
          subnet claim) is gated to haxixe.eth. Non-connected keeps the read-only view. */}
      {connected ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {isOwner && (
              <button type="button" onClick={claim} disabled={!!busy || !canClaim} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
                {busy === "claim" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t.claim}
              </button>
            )}
            <button type="button" onClick={advanceMor} disabled={!!busy || !canAdvanceMor} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
              {busy === "mor" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t.advanceMor}
            </button>
            <span className="inline-flex items-center gap-1">
              {isOwner && (
                <button type="button" onClick={() => nativeSwap("A")} disabled={!!busy} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
                  {busy === "swapA" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Swap A{mUsd(status.swapperAMor) ? ` · ~${mUsd(status.swapperAMor)}` : ""}
                </button>
              )}
              <a href={splitsUrl(PIPELINE.swapperA)} target="_blank" rel="noopener noreferrer" title={t.swapFallbackTitle} className={`${btn} border border-border bg-surface-elevated text-foreground-muted hover:text-foreground ${isOwner ? "px-2" : ""}`}>
                {isOwner ? <ExternalLink className="h-3 w-3" /> : <>Swap A{mUsd(status.swapperAMor) ? ` · ~${mUsd(status.swapperAMor)}` : ""} <ExternalLink className="h-3 w-3" /></>}
              </a>
            </span>
            <span className="inline-flex items-center gap-1">
              {isOwner && (
                <button type="button" onClick={() => nativeSwap("B")} disabled={!!busy} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
                  {busy === "swapB" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Swap B{eUsd(status.swapperBWeth) ? ` · ~${eUsd(status.swapperBWeth)}` : ""}
                </button>
              )}
              <a href={splitsUrl(PIPELINE.swapperB)} target="_blank" rel="noopener noreferrer" title={t.swapFallbackTitle} className={`${btn} border border-border bg-surface-elevated text-foreground-muted hover:text-foreground ${isOwner ? "px-2" : ""}`}>
                {isOwner ? <ExternalLink className="h-3 w-3" /> : <>Swap B{eUsd(status.swapperBWeth) ? ` · ~${eUsd(status.swapperBWeth)}` : ""} <ExternalLink className="h-3 w-3" /></>}
              </a>
            </span>
            <button type="button" onClick={advanceUsdc} disabled={!!busy || !canAdvanceUsdc} className={`${btn} border border-border-strong bg-surface-elevated text-foreground hover:bg-foreground/5`}>
              {busy === "usdc" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t.advanceUsdc}
            </button>
          </div>

          {!isOwner && (
            <p className="mt-2 text-[11px] text-foreground-faint">
              {rich(t.notOwnerNote)}
            </p>
          )}

          {err && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
          <p className="mt-3 text-[11px] text-foreground-faint">
            {rich(t.order)}
          </p>
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] text-foreground-faint">
          {rich(t.connectNote)}
        </p>
      )}
    </section>
  );
}
