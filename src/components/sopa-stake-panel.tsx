"use client";

// Stake MOR into the Gnars Builder subnet from the portal. As the MOR→USDC
// pipeline pays SOPA its 10% in MOR, this compounds it straight back into the
// Gnars subnet (BuildersV4.deposit) — approve + deposit from a connected wallet
// on Base. Principal is the wallet's; withdraw after the subnet's 7-day lock.
// Copy is PT-BR to match the rest of the treasury page.

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, getAddress, parseUnits, formatUnits, encodeFunctionData, type Address } from "viem";
import { base } from "viem/chains";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";
import { Loader2, Plug } from "lucide-react";
import { PIPELINE, TOKENS } from "@/lib/mor-pipeline";
import { useWallet } from "@/components/wallet-provider";

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

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function SopaStakePanel() {
  const dict = useT().treasury;
  const t = dict.mor;
  const { address: account, connect: connectWallet, connecting, ensureChain } = useWallet();
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

  // A carteira já vem conectada de outra tela ou do carregamento anterior, então
  // a leitura dos saldos não pode morar dentro do `connect()` — ela acompanha o
  // endereço. Sem isto o painel abriria conectado e com os números zerados.
  useEffect(() => {
    if (account) read(account);
  }, [account, read]);

  async function connect() {
    setErr(null);
    const a = await connectWallet();
    if (a) await ensureChain("0x2105");
  }

  // Raw eth_sendTransaction ({from,to,data}) — the wallet fills gas/fees/nonce.
  // Most compatible with injected wallets (viem's writeContract adds fields some
  // wallet RPCs reject).
  async function send(to: Address, data: `0x${string}`) {
    await ensureChain("0x2105");
    const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
    const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from: getAddress(account!), to, data }] })) as `0x${string}`;
    await pub.waitForTransactionReceipt({ hash });
  }

  async function stake() {
    if (!account) return;
    let amt: bigint;
    try { amt = parseUnits(amount, 18); } catch { setErr("Valor inválido."); return; }
    if (amt <= BigInt(0)) return;
    setBusy("stake"); setErr(null);
    try {
      const allowance = await pub.readContract({ address: MOR, abi: erc20, functionName: "allowance", args: [getAddress(account), PIPELINE.builders] });
      if (allowance < amt) {
        await send(MOR, encodeFunctionData({ abi: erc20, functionName: "approve", args: [PIPELINE.builders, amt] }));
      }
      await send(PIPELINE.builders, encodeFunctionData({ abi: buildersStake, functionName: "deposit", args: [PIPELINE.subnetId, amt] }));
      setAmount(""); await read(account);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falha ao stakear.");
    } finally { setBusy(null); }
  }

  async function withdraw() {
    if (!account || staked <= 0) return;
    setBusy("withdraw"); setErr(null);
    try {
      await send(PIPELINE.builders, encodeFunctionData({ abi: buildersStake, functionName: "withdraw", args: [PIPELINE.subnetId, parseUnits(String(staked), 18)] }));
      await read(account);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? t.withdrawFailed);
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t.stakeTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
            {t.stakeHint}
          </p>
        </div>
        {!account && (
          <button type="button" onClick={connect} disabled={connecting} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40">
            <Plug className="h-3.5 w-3.5" /> {dict.wallet.connect}
          </button>
        )}
      </div>

      {account && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">{t.walletMor}</div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">{fmt(balance)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">{t.yourStake}</div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">{fmt(staked)}</div>
            </div>
          </div>

          {balance <= 0 && staked <= 0 && (
            <p className="mt-3 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] text-foreground-faint">
              {t.noMor}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder={t.stakePlaceholder}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong"
            />
            <button type="button" onClick={() => setAmount(String(balance))} disabled={balance <= 0} className="shrink-0 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground-muted transition hover:text-foreground disabled:opacity-40">{t.max}</button>
            <button type="button" onClick={stake} disabled={!!busy || !amount} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-4 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40">
              {busy === "stake" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t.stake}
            </button>
          </div>

          {staked > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-3 py-2">
              <span className="text-xs text-foreground-muted">{rich(t.withdrawStake(fmt(staked)))}</span>
              <button type="button" onClick={withdraw} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-foreground/5 disabled:opacity-40">
                {busy === "withdraw" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t.withdraw}
              </button>
            </div>
          )}
        </>
      )}

      {err && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
    </section>
  );
}
