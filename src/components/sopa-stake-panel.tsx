"use client";

// Stake MOR into the Gnars Builder subnet from the portal. As the MOR→USDC
// pipeline pays SOPA its 10% in MOR, this compounds it straight back into the
// Gnars subnet (BuildersV4.deposit) — approve + deposit from a connected wallet
// on Base. Principal is the wallet's; withdraw after the subnet's 7-day lock.

import { useState, useCallback } from "react";
import { createWalletClient, createPublicClient, custom, http, getAddress, parseUnits, formatUnits, type Address } from "viem";
import { base } from "viem/chains";
import { Loader2, Plug } from "lucide-react";
import { PIPELINE, TOKENS } from "@/lib/mor-pipeline";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const pub = createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com") });
const MOR = TOKENS.mor.address;

const erc20 = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const buildersStake = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "subnetId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "subnetId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "usersData", stateMutability: "view", inputs: [{ name: "u", type: "address" }, { name: "s", type: "bytes32" }], outputs: [{ type: "uint128" }, { type: "uint128" }, { name: "deposited", type: "uint256" }, { type: "uint256" }] },
] as const;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export function SopaStakePanel() {
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [staked, setStaked] = useState(0);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const read = useCallback(async (addr: string) => {
    try {
      const [bal, user] = await Promise.all([
        pub.readContract({ address: MOR, abi: erc20, functionName: "balanceOf", args: [addr as Address] }),
        pub.readContract({ address: PIPELINE.builders, abi: buildersStake, functionName: "usersData", args: [addr as Address, PIPELINE.subnetId] }),
      ]);
      setBalance(Number(formatUnits(bal, 18)));
      setStaked(Number(formatUnits(user[2], 18)));
    } catch { /* leave as-is */ }
  }, []);

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
      const a = getAddress(accs[0]);
      setAccount(a);
      read(a);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Connect failed.");
    }
  }

  function wallet() {
    const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
    return createWalletClient({ account: getAddress(account!), chain: base, transport: custom(eth) });
  }

  async function stake() {
    if (!account) return;
    let amt: bigint;
    try { amt = parseUnits(amount, 18); } catch { setErr("Invalid amount."); return; }
    if (amt <= BigInt(0)) return;
    setBusy("stake"); setErr(null);
    try {
      const w = wallet();
      const allowance = await pub.readContract({ address: MOR, abi: erc20, functionName: "allowance", args: [getAddress(account), PIPELINE.builders] });
      if (allowance < amt) {
        const h = await w.writeContract({ address: MOR, abi: erc20, functionName: "approve", args: [PIPELINE.builders, amt] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      const h2 = await w.writeContract({ address: PIPELINE.builders, abi: buildersStake, functionName: "deposit", args: [PIPELINE.subnetId, amt] });
      await pub.waitForTransactionReceipt({ hash: h2 });
      setAmount(""); await read(account);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Stake failed.");
    } finally { setBusy(null); }
  }

  async function withdraw() {
    if (!account || staked <= 0) return;
    setBusy("withdraw"); setErr(null);
    try {
      const w = wallet();
      const h = await w.writeContract({ address: PIPELINE.builders, abi: buildersStake, functionName: "withdraw", args: [PIPELINE.subnetId, parseUnits(String(staked), 18)] });
      await pub.waitForTransactionReceipt({ hash: h });
      await read(account);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Withdraw failed (7-day lock?).");
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Stake MOR on the Gnars subnet</h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
            Compound SOPA&apos;s MOR back into the Gnars Builder subnet. Approve + deposit from a connected wallet on
            Base; principal stays yours, withdrawable after the 7-day lock.
          </p>
        </div>
        {!account && (
          <button type="button" onClick={connect} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20">
            <Plug className="h-3.5 w-3.5" /> Connect wallet
          </button>
        )}
      </div>

      {account && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Wallet MOR</div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">{fmt(balance)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Your stake</div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">{fmt(staked)}</div>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder="MOR to stake"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong"
            />
            <button type="button" onClick={() => setAmount(String(balance))} disabled={balance <= 0} className="shrink-0 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground-muted transition hover:text-foreground disabled:opacity-40">Max</button>
            <button type="button" onClick={stake} disabled={!!busy || !amount} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-4 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40">
              {busy === "stake" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Stake
            </button>
          </div>

          {staked > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-3 py-2">
              <span className="text-xs text-foreground-muted">Withdraw your <b className="text-foreground">{fmt(staked)} MOR</b> (after the 7-day lock)</span>
              <button type="button" onClick={withdraw} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-foreground/5 disabled:opacity-40">
                {busy === "withdraw" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Withdraw
              </button>
            </div>
          )}
        </>
      )}

      {err && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
    </section>
  );
}
