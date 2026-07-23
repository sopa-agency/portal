"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, createWalletClient, custom, http, formatUnits, parseUnits, getAddress, erc20Abi } from "viem";
import { base } from "viem/chains";
import { PiggyBank, Loader2, Wallet, ExternalLink, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, TrendingUp } from "lucide-react";
import type { VaultInfo } from "@/lib/community-vaults";

// Community staking UI. Everything is the depositor's own wallet talking to a
// standard ERC-4626 vault — no server, no keys, no custody by the portal. The
// deposit stays theirs and `withdraw` is always available.

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const VAULT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "redeem", type: "function", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  // Position value: convertToAssets(shares). maxWithdraw returns 0 here because
  // the liquidity sits in the Moonwell adapter, not idle.
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const pub = () => createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

const fmt = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

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

function VaultCard({ info }: { info: VaultInfo }) {
  const { vault } = info;
  const router = useRouter();
  const [account, setAccount] = useState<string | null>(null);
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [shares, setShares] = useState<bigint>(BigInt(0));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const refresh = useCallback(
    async (who: string) => {
      try {
        const c = pub();
        const [bal, shareBal] = await Promise.all([
          c.readContract({ address: getAddress(vault.asset), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(who)] }),
          c.readContract({ address: getAddress(vault.address), abi: VAULT_ABI, functionName: "balanceOf", args: [getAddress(who)] }),
        ]);
        setWalletBal(Number(formatUnits(bal, vault.assetDecimals)));
        setShares(shareBal);
        // Value the shares. maxWithdraw would read 0 (liquidity is in the adapter).
        const assets =
          shareBal > BigInt(0)
            ? await c.readContract({ address: getAddress(vault.address), abi: VAULT_ABI, functionName: "convertToAssets", args: [shareBal] })
            : BigInt(0);
        setPosition(Number(formatUnits(assets, vault.assetDecimals)));
      } catch {
        /* leave as unknown rather than showing a wrong number */
      }
    },
    [vault.asset, vault.address, vault.assetDecimals],
  );

  async function connect() {
    setErr(null);
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum;
      if (!eth) throw new Error("Nenhuma carteira detectada. Instale MetaMask/Rabby e recarregue.");
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
    if (!Number.isFinite(value) || value <= 0) return setErr("Digite um valor maior que zero.");
    try {
      const eth = (window as unknown as { ethereum?: Eth }).ethereum!;
      await ensureBase(eth);
      const wallet = createWalletClient({ account: getAddress(account), chain: base, transport: custom(eth) });
      const c = pub();
      const assets = parseUnits(amount.trim(), vault.assetDecimals);
      const vaultAddr = getAddress(vault.address);

      if (mode === "deposit") {
        // Approve only what's missing, and only the exact amount — no infinite approvals.
        const allowance = await c.readContract({
          address: getAddress(vault.asset),
          abi: erc20Abi,
          functionName: "allowance",
          args: [getAddress(account), vaultAddr],
        });
        if (allowance < assets) {
          setBusy("Aprovando…");
          const ah = await wallet.writeContract({
            address: getAddress(vault.asset),
            abi: erc20Abi,
            functionName: "approve",
            args: [vaultAddr, assets],
          });
          await c.waitForTransactionReceipt({ hash: ah });
        }
        setBusy("Depositando…");
        const h = await wallet.writeContract({
          address: vaultAddr,
          abi: VAULT_ABI,
          functionName: "deposit",
          args: [assets, getAddress(account)],
        });
        await c.waitForTransactionReceipt({ hash: h });
        setTx(h);
      } else {
        setBusy("Sacando…");
        // Withdrawing the whole position: redeem ALL shares. withdraw(assets)
        // rounds shares up and can revert at the exact max; redeem(shares) can't.
        const full = position != null && value >= position - 1e-6;
        const h =
          full && shares > BigInt(0)
            ? await wallet.writeContract({
                address: vaultAddr,
                abi: VAULT_ABI,
                functionName: "redeem",
                args: [shares, getAddress(account), getAddress(account)],
              })
            : await wallet.writeContract({
                address: vaultAddr,
                abi: VAULT_ABI,
                functionName: "withdraw",
                args: [assets, getAddress(account), getAddress(account)],
              });
        await c.waitForTransactionReceipt({ hash: h });
        setTx(h);
      }
      setAmount("");
      await refresh(account);
      router.refresh();
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falhou.");
    } finally {
      setBusy(null);
    }
  }

  const max = mode === "deposit" ? walletBal : position;

  return (
    <div className="overflow-hidden rounded-2xl border border-accent-border bg-surface">
      <div className="grid lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT — brand, split, balances, action */}
        <div className="p-6 lg:border-r lg:border-border">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent-border bg-accent-bg text-accent">
          <PiggyBank className="h-5 w-5" />
        </span>
        <h3 className="text-lg font-bold text-foreground">Cofre {vault.label}</h3>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-foreground-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#6E86FF" }} /> Moonwell
        </span>
      </div>
      {vault.note && <p className="mt-4 text-sm leading-relaxed text-foreground-muted">{vault.note}</p>}

      {/* Where the yield actually goes — read from the contract, not claimed.
          A failed read must NOT render as "0% fee": that would state a number we
          never observed. It gets its own state. */}
      <div
        className={`mt-5 rounded-xl border p-4 text-xs ${
          info.error
            ? "border-border bg-surface-elevated text-foreground-muted"
            : info.paysSopa
              ? "border-accent-border bg-accent-bg text-foreground-muted"
              : "border-warning/30 bg-warning/10 text-warning"
        }`}
      >
        {info.error ? (
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Não consegui ler a configuração deste cofre agora (a rede pública engasgou). Recarregue em instantes — prefiro não
              mostrar número nenhum a mostrar um errado.
            </span>
          </div>
        ) : info.paysSopa ? (
          <>
            {/* 50/50 split bar — where the yield goes, at a glance. */}
            <div className="mb-2.5 flex h-2 gap-[3px] overflow-hidden rounded-full">
              <span className="rounded-full bg-accent" style={{ flex: info.fee * 100 }} />
              <span className="rounded-full bg-foreground/20" style={{ flex: (1 - info.fee) * 100 }} />
            </div>
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold tracking-wide">
              <span className="text-accent">{Math.round(info.fee * 100)}% → TESOURO SOPA</span>
              <span className="text-foreground-muted">{Math.round((1 - info.fee) * 100)}% → VOCÊ</span>
            </div>
            <span>
              <b className="text-foreground">{Math.round(info.fee * 100)}% dos juros</b> deste cofre vão pro tesouro da SOPA e financiam o
              payroll. Os outros {Math.round((1 - info.fee) * 100)}% ficam com você. Seu depósito continua seu — dá pra sacar quando quiser.
            </span>
          </>
        ) : (
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Este cofre não é da SOPA.</b> A taxa de {Math.round(info.fee * 100)}% vai pra{" "}
              <code className="font-mono">{info.feeRecipient.slice(0, 6)}…{info.feeRecipient.slice(-4)}</code>, não pro tesouro —
              depositar aqui <b>não financia o payroll</b>. Você rende normalmente; a SOPA não ganha nada. Só muda quando a SOPA
              publicar o cofre dela.
            </span>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-4 text-xs text-foreground-muted">
        <span>
          No cofre: <b className="font-mono tabular-nums text-foreground">{fmt(info.totalAssets, 0)}</b> {vault.assetSymbol}
        </span>
        {account && (
          <>
            <span>
              Você tem lá:{" "}
              <b className="font-mono tabular-nums text-foreground">{position == null ? "…" : fmt(position, 4)}</b> {vault.assetSymbol}
            </span>
            <span>
              Na carteira:{" "}
              <b className="font-mono tabular-nums text-foreground">{walletBal == null ? "…" : fmt(walletBal, 4)}</b> {vault.assetSymbol}
            </span>
          </>
        )}
      </div>

      {!account ? (
        <button
          type="button"
          onClick={connect}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent hover:brightness-110"
        >
          <Wallet className="h-4 w-4" /> Conectar carteira
        </button>
      ) : (
        <div className="mt-4 space-y-2.5">
          <div className="flex gap-1 rounded-lg bg-surface-elevated p-1">
            {(["deposit", "withdraw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setAmount(""); setErr(null); }}
                aria-pressed={mode === m}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === m ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {m === "deposit" ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                {m === "deposit" ? "Depositar" : "Sacar"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2">
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              className="w-full min-w-0 bg-transparent font-mono text-sm tabular-nums text-foreground outline-none"
            />
            <span className="text-xs text-foreground-faint">{vault.assetSymbol}</span>
            {max != null && max > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(max))}
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
            {busy ?? (mode === "deposit" ? `Depositar ${vault.assetSymbol}` : `Sacar ${vault.assetSymbol}`)}
          </button>

          <p className="text-[10px] text-foreground-faint">
            Conectado como {account.slice(0, 6)}…{account.slice(-4)} · a transação sai da sua carteira, o portal não custodia nada.
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
          Ver transação <ExternalLink className="h-3 w-3" />
        </a>
      )}
        </div>

        {/* RIGHT — big APY + sparkline (desktop). The grid row stretches this
            column to match the left column's height (whatever state it's in —
            just the Connect button, or the full deposit/withdraw form), so the
            content is laid out top-to-bottom instead of centered: the APY block
            anchors to the top and the sparkline grows to fill the rest, so
            there's no dead space floating under/right of the CTA. Sparkline is
            a decorative flourish, not real history; kept subtle and unlabeled
            on purpose. */}
        <div className="hidden flex-col bg-black/10 p-6 dark:bg-black/20 lg:flex">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-faint">Rende ao ano</div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-mono text-5xl font-semibold leading-none tracking-tight text-emerald-600 dark:text-emerald-400">
                {info.apy != null ? `${(info.apy * 100).toFixed(2)}%` : "—"}
              </span>
              {info.apy != null && <span className="text-sm font-medium text-foreground-faint">APY</span>}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              {info.apy != null ? "variável · no cofre da Moonwell" : "aguardando índice da Moonwell · variável"}
            </div>
          </div>

          <div className="mt-6 flex flex-1 items-end">
            <svg width="100%" height="100%" viewBox="0 0 220 90" preserveAspectRatio="none" className="overflow-visible" aria-hidden>
              <defs>
                <linearGradient id="vs-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--success)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,66 L22,59 L44,63 L66,47 L88,51 L110,35 L132,41 L154,24 L176,29 L198,14 L220,18 L220,90 L0,90 Z" fill="url(#vs-spark)" />
              <path d="M0,66 L22,59 L44,63 L66,47 L88,51 L110,35 L132,41 L154,24 L176,29 L198,14 L220,18" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VaultStaking({ vaults }: { vaults: VaultInfo[] }) {
  if (vaults.length === 0) return null;
  const anyPaysSopa = vaults.some((v) => v.paysSopa);

  return (
    <div className="space-y-4">
      {/* The "Apoiar o payroll" heading + stats now live in VaultSupportSummary,
          rendered above this on the page — no duplicate header here. */}
      {!anyPaysSopa && (
        <div className="flex gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>Ainda não existe cofre da SOPA.</b> Os cofres abaixo são de terceiros: você rende, mas a taxa vai pro curador deles e
            nada chega no payroll. Isso só muda quando a SOPA publicar o próprio cofre e apontar o destinatário da taxa pro Safe.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {vaults.map((v) => (
          <VaultCard key={v.vault.key} info={v} />
        ))}
      </div>
    </div>
  );
}
