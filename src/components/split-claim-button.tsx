"use client";

// Permissionless "collect" for a 0xSplits revenue split, inline on a treasury
// revenue row. A split accrues fee revenue but the money only reaches the
// recipients on `distribute()` (+ `withdraw()` from the Warehouse for a
// PullSplit). Both are permissionless — funds can only go to the split's fixed
// recipients — so any connected wallet can trigger them. Renders nothing when
// there's nothing to collect (or the address isn't a readable split). Copy PT-BR.

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, getAddress, encodeFunctionData, type Address } from "viem";
import { base } from "viem/chains";
import { Loader2, Plug, DownloadCloud } from "lucide-react";
import { fetchSplitClaim } from "@/app/actions/split-claim";
import type { SplitClaim } from "@/lib/split-claim";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const pub = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const splitAbi = [
  {
    type: "function",
    name: "distribute",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_split",
        type: "tuple",
        components: [
          { name: "recipients", type: "address[]" },
          { name: "allocations", type: "uint256[]" },
          { name: "totalAllocation", type: "uint256" },
          { name: "distributionIncentive", type: "uint16" },
        ],
      },
      { name: "_token", type: "address" },
      { name: "_distributor", type: "address" },
    ],
    outputs: [],
  },
] as const;
const warehouseAbi = [
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "_owner", type: "address" }, { name: "_token", type: "address" }], outputs: [] },
] as const;

/** Aggregate distributable + withdrawable into a "12.5 USDC · 0.003 WETH" summary. */
function summarize(claim: SplitClaim): string {
  const bySym = new Map<string, number>();
  for (const t of [...claim.distributable, ...claim.withdrawable]) bySym.set(t.symbol, (bySym.get(t.symbol) ?? 0) + t.amountUi);
  return [...bySym.entries()]
    .map(([sym, amt]) => `${amt.toLocaleString("pt-BR", { maximumFractionDigits: amt >= 1 ? 2 : 6 })} ${sym}`)
    .join(" · ");
}

// `showEmpty` makes a confirmed split with nothing pending SAY so instead of
// vanishing. The treasury leaves it off — there a silent row is fine, the panel
// is an extra on a stream that already shows its own numbers. The address book
// turns it on, because there "no panel" and "no balance" would be
// indistinguishable, and answering "how much is sitting in this split?" is the
// whole reason the panel is on that page.
export function SplitClaimButton({
  address,
  chain,
  showEmpty = false,
}: {
  address: string;
  chain: string | null;
  showEmpty?: boolean;
}) {
  const [claim, setClaim] = useState<SplitClaim | null>(null);
  // getSplitClaim returns null for anything that is not a readable 0xSplits
  // contract on Base, so a non-null read is itself the proof that it IS one.
  // Tracked separately from `claim`, which goes null again once it is empty.
  const [isSplit, setIsSplit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSplitClaim(address, chain)
      .then((c) => {
        setIsSplit(!!c);
        setClaim(c && (c.distributable.length > 0 || c.withdrawable.length > 0) ? c : null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [address, chain]);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error("Nenhuma carteira detectada.");
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      if (cid !== "0x2105") {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }).catch(() => {});
      }
      setAccount(getAddress(accs[0]));
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falha ao conectar.");
    }
  }

  // Send one raw eth_sendTransaction, tolerant of smart / 7702 wallets that
  // broadcast but return a -32602 error or an unresolvable (userOp) hash.
  async function send(eth: Eth, from: Address, to: Address, data: `0x${string}`) {
    let hash: string | undefined;
    try {
      hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data }] })) as string;
    } catch (e) {
      const code = (e as { code?: number }).code;
      const msg = ((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "").toLowerCase();
      if (code === 4001 || msg.includes("reject") || msg.includes("denied")) throw e;
      if (code === -32602 || msg.includes("invalid param")) return void (await sleep(8000));
      throw e;
    }
    if (typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)) {
      await pub.waitForTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => sleep(8000));
    } else {
      await sleep(8000);
    }
  }

  const collect = useCallback(async () => {
    if (!account || !claim) return;
    setBusy(true);
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      const from = getAddress(account);
      const struct = {
        recipients: claim.config.recipients.map((r) => getAddress(r)),
        allocations: claim.config.allocations.map((a) => BigInt(a)),
        totalAllocation: BigInt(claim.config.totalAllocation),
        distributionIncentive: claim.config.distributionIncentive,
      };

      // Phase A — distribute each token sitting in the split.
      for (const t of claim.distributable) {
        const data = encodeFunctionData({ abi: splitAbi, functionName: "distribute", args: [struct, getAddress(t.address), from] });
        await send(eth, from, getAddress(claim.config.address), data);
      }

      // Phase B — re-read (a PullSplit only credits the Warehouse on distribute),
      // then withdraw every recipient credit so the money lands in their wallets.
      const fresh = (await fetchSplitClaim(address, chain).catch(() => null)) ?? claim;
      for (const w of fresh.withdrawable) {
        const data = encodeFunctionData({ abi: warehouseAbi, functionName: "withdraw", args: [getAddress(w.recipient), getAddress(w.address)] });
        await send(eth, from, getAddress(claim.warehouse), data);
      }

      load();
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falha ao recolher.");
    } finally {
      setBusy(false);
    }
  }, [account, claim, address, chain, load]);

  if (!claim) {
    // A read that FAILED or has not finished must never render as "nothing
    // here" — only a completed read of a real split earns the empty state.
    if (!showEmpty || !loaded || !isSplit) return null;
    return (
      <div className="my-2 flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] text-foreground-faint">
        <DownloadCloud className="h-3.5 w-3.5" />
        Split sem saldo a recolher
      </div>
    );
  }

  return (
    <div className="my-2 flex flex-wrap items-center gap-2 rounded-md border border-accent-border bg-accent-bg/40 px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
        <DownloadCloud className="h-3.5 w-3.5 text-accent" />
        Recolhível: <span className="font-semibold text-foreground">{summarize(claim)}</span>
      </span>
      {account ? (
        <button
          type="button"
          onClick={collect}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent px-2.5 py-1 text-[11px] font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Recolher
        </button>
      ) : (
        <button
          type="button"
          onClick={connect}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20"
        >
          <Plug className="h-3 w-3" /> Conectar
        </button>
      )}
      {err && <p className="w-full text-[11px] text-danger">{err}</p>}
    </div>
  );
}
