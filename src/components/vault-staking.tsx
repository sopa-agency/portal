"use client";

import { useCallback, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, formatUnits, parseUnits, getAddress, erc20Abi } from "viem";
import { base } from "viem/chains";
import { PiggyBank, Loader2, Wallet, ExternalLink, AlertTriangle, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { VaultInfo } from "@/lib/community-vaults";

// Community staking UI. Everything is the depositor's own wallet talking to a
// standard ERC-4626 vault — no server, no keys, no custody by the portal. The
// deposit stays theirs and `withdraw` is always available.

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const VAULT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "maxWithdraw", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
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
  const [account, setAccount] = useState<string | null>(null);
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const refresh = useCallback(
    async (who: string) => {
      try {
        const c = pub();
        const [bal, pos] = await Promise.all([
          c.readContract({ address: getAddress(vault.asset), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(who)] }),
          c.readContract({ address: getAddress(vault.address), abi: VAULT_ABI, functionName: "maxWithdraw", args: [getAddress(who)] }),
        ]);
        setWalletBal(Number(formatUnits(bal, vault.assetDecimals)));
        setPosition(Number(formatUnits(pos, vault.assetDecimals)));
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
        const h = await wallet.writeContract({
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
    } catch (e) {
      setErr((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Falhou.");
    } finally {
      setBusy(null);
    }
  }

  const max = mode === "deposit" ? walletBal : position;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <PiggyBank className="h-4 w-4 text-accent" /> Cofre {vault.label}
          </h3>
          {vault.note && <p className="mt-0.5 text-xs text-foreground-subtle">{vault.note}</p>}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Rende ao ano</div>
          <div className="font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {info.apy != null ? `${(info.apy * 100).toFixed(2)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Where the yield actually goes — read from the contract, not claimed.
          A failed read must NOT render as "0% fee": that would state a number we
          never observed. It gets its own state. */}
      <div
        className={`mt-3 rounded-xl border p-3 text-xs ${
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
            <b className="text-foreground">{Math.round(info.fee * 100)}% dos juros</b> deste cofre vão pro tesouro da SOPA e financiam o
            payroll. Os outros {Math.round((1 - info.fee) * 100)}% ficam com você. Seu depósito continua seu — dá pra sacar quando quiser.
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

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-foreground-muted">
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
  );
}

export function VaultStaking({ vaults }: { vaults: VaultInfo[] }) {
  if (vaults.length === 0) return null;
  const anyPaysSopa = vaults.some((v) => v.paysSopa);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">Apoiar o payroll</h2>
        <p className="mt-0.5 max-w-2xl text-xs text-foreground-subtle">
          Deposite num cofre e continue rendendo. Uma parte dos juros vai pro tesouro da SOPA e paga o time — o principal segue seu, e
          você saca quando quiser. Não é doação: é o rendimento que é compartilhado, não o depósito.
        </p>
      </div>

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
