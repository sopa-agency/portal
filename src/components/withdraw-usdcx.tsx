"use client";

import { useCallback, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, getAddress, formatUnits, parseUnits } from "viem";
import { base } from "viem/chains";
import { ArrowUpFromLine, Loader2, Wallet, ExternalLink } from "lucide-react";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

// A payee unwraps (downgrades) their streamed USDCx → plain USDC, into their own
// wallet. USDCx is a Superfluid Super Token: it can't be spent/sold directly, so
// downgrade() burns it 1:1 for the underlying USDC. The member signs from THEIR
// wallet (msg.sender receives the USDC) — the portal custodies nothing, same model
// as the vault card and the connect-pool button.

// Super USDC (USDCx) on Base. Hardcoded because @/lib/superfluid is server-only
// and can't be imported into a client component.
const USDCX = "0xD04383398dD2426297da660F9CCA3d439AF9ce1b";

const ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "downgrade", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const pub = () => createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

async function ensureBase(eth: Eth) {
  const cid = (await eth.request({ method: "eth_chainId" })) as string;
  if (cid === "0x2105") return;
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

export function WithdrawUsdcx() {
  const dict = useT().treasury;
  const t = dict.withdraw;
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const refresh = useCallback(async (who: string) => {
    try {
      const bal = await pub().readContract({ address: getAddress(USDCX), abi: ABI, functionName: "balanceOf", args: [getAddress(who)] });
      const n = Number(formatUnits(bal, 18));
      setBalance(n);
      setAmount(n > 0 ? String(n) : "");
    } catch {
      /* leave the balance unknown rather than showing a wrong number */
    }
  }, []);

  async function connect() {
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error(dict.wallet.none);
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      await ensureBase(eth);
      const who = getAddress(accs[0]);
      setAccount(who);
      await refresh(who);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message);
    }
  }

  async function run() {
    if (!account) return;
    setErr(null);
    setTx(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setErr(dict.wallet.amountPositive);
    if (balance != null && value > balance + 1e-9) return setErr(t.notEnough);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      await ensureBase(eth);
      const wallet = createWalletClient({ account: getAddress(account), chain: base, transport: custom(eth) });
      const c = pub();
      setBusy(t.busy);
      const h = await wallet.writeContract({
        address: getAddress(USDCX),
        abi: ABI,
        functionName: "downgrade",
        args: [parseUnits(amount.trim(), 18)],
      });
      await c.waitForTransactionReceipt({ hash: h });
      setTx(h);
      setAmount("");
      await refresh(account);
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? dict.wallet.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <ArrowUpFromLine className="h-4 w-4 text-accent" /> {t.title}
      </h2>
      <p className="mt-1.5 max-w-xl text-xs text-foreground-subtle">
        {rich(t.body)}
      </p>

      {!account ? (
        <button
          type="button"
          onClick={connect}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent hover:brightness-110"
        >
          <Wallet className="h-4 w-4" /> {dict.wallet.connectMine}
        </button>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className="text-xs text-foreground-muted">
            {t.inWallet} <b className="font-mono tabular-nums text-foreground">{balance == null ? "…" : fmt(balance)}</b> USDCx
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2">
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              aria-label={t.amountLabel}
              className="w-full min-w-0 bg-transparent font-mono text-sm tabular-nums text-foreground outline-none"
            />
            <span className="text-xs text-foreground-faint">USDCx</span>
            {balance != null && balance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted hover:text-foreground"
              >
                MAX
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!!busy || !amount}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ?? t.action}
          </button>
          <p className="text-[10px] text-foreground-faint">
            {t.footer(`${account.slice(0, 6)}…${account.slice(-4)}`)}
          </p>
        </div>
      )}

      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
      {tx && (
        <a
          href={`https://basescan.org/tx/${tx}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          {dict.wallet.viewTx} <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </section>
  );
}
