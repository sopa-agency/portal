"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Copy, Wallet } from "lucide-react";
import { createWalletClient, custom } from "viem";
import {
  getBountySetup,
  saveBountyConfig,
  getDelegateSignPayload,
  registerDelegate,
  type BountySetup as Setup,
} from "@/app/actions/bounty";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function BountySetup() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ safeAddress: "", chainId: 8453, tokenAddress: "", tokenSymbol: "ETH", tokenDecimals: 18 });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const r = await getBountySetup();
    setLoading(false);
    if (r.ok) {
      setSetup(r.setup);
      if (r.setup.config) {
        const c = r.setup.config;
        setForm({ safeAddress: c.safeAddress, chainId: c.chainId, tokenAddress: c.tokenAddress ?? "", tokenSymbol: c.tokenSymbol, tokenDecimals: c.tokenDecimals });
      }
    } else setMsg({ ok: false, text: r.error });
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const r = await saveBountyConfig({ ...form, tokenAddress: form.tokenAddress.trim() || null });
    setSaving(false);
    if (r.ok) { setMsg({ ok: true, text: "Config salva ✅" }); await load(); }
    else setMsg({ ok: false, text: r.error });
  }

  async function registerAsDelegate() {
    setBusy(true);
    setMsg(null);
    try {
      const payload = await getDelegateSignPayload();
      if (!payload.ok) { setMsg({ ok: false, text: payload.error }); return; }
      const eth = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!eth) { setMsg({ ok: false, text: "Carteira não detectada (instale/abra MetaMask ou Rabby)." }); return; }
      const wc = createWalletClient({ transport: custom(eth as Parameters<typeof custom>[0]) });
      const [delegator] = await wc.requestAddresses();
      const signature = await wc.signTypedData({
        account: delegator,
        domain: payload.domain as Record<string, unknown>,
        types: payload.types as Record<string, { name: string; type: string }[]>,
        primaryType: payload.primaryType,
        message: payload.message as Record<string, unknown>,
      });
      const r = await registerDelegate(delegator, signature);
      if (r.ok) { setMsg({ ok: true, text: "Proposer registrado como delegate ✅" }); await load(); }
      else setMsg({ ok: false, text: r.error });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Falha ao assinar." });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-foreground-muted"><Loader2 className="inline h-4 w-4 animate-spin" /> Carregando bounty setup…</p>;
  if (!setup) return null;

  return (
    <section aria-labelledby="bounty-heading" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 id="bounty-heading" className="text-lg font-semibold tracking-tight text-foreground">Bounties &amp; Safe</h2>
        <span className="text-xs text-foreground-faint">tarefas do Kanban viram bounties pagas pelo Safe</span>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}

      {/* Proposer */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Proposer (delegate do Safe — só propõe)</div>
        {setup.proposer ? (
          <button type="button" onClick={() => navigator.clipboard?.writeText(setup.proposer!)} title="Copiar" className="mt-1 flex w-full items-center gap-1.5 truncate font-mono text-xs text-accent hover:underline">
            <Copy className="h-3 w-3 shrink-0" /> {setup.proposer}
          </button>
        ) : (
          <p className="mt-1 text-xs text-danger">SAFE_PROPOSER_PRIVATE_KEY não configurado.</p>
        )}
      </div>

      {/* Config form */}
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
        <label className="block text-xs text-foreground-muted">Endereço do Safe
          <input value={form.safeAddress} onChange={(e) => setForm({ ...form, safeAddress: e.target.value })} placeholder="0x…" className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
        </label>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs text-foreground-muted">Rede
            <select value={form.chainId} onChange={(e) => setForm({ ...form, chainId: Number(e.target.value) })} className="mt-1 block rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground">
              <option value={8453}>Base</option>
              <option value={1}>Ethereum</option>
            </select>
          </label>
          <label className="text-xs text-foreground-muted">Token
            <input value={form.tokenSymbol} onChange={(e) => setForm({ ...form, tokenSymbol: e.target.value })} className="mt-1 block w-20 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground" />
          </label>
          <label className="text-xs text-foreground-muted">Decimais
            <input type="number" value={form.tokenDecimals} onChange={(e) => setForm({ ...form, tokenDecimals: Number(e.target.value) })} className="mt-1 block w-20 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground" />
          </label>
        </div>
        <label className="block text-xs text-foreground-muted">Token address (vazio = ETH nativo)
          <input value={form.tokenAddress} onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })} placeholder="0x… (ERC-20) ou vazio p/ ETH" className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setForm({ ...form, chainId: 8453, tokenAddress: USDC_BASE, tokenSymbol: "USDC", tokenDecimals: 6 })} className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground">Preset: USDC (Base)</button>
          <button type="button" onClick={() => setForm({ ...form, tokenAddress: "", tokenSymbol: "ETH", tokenDecimals: 18 })} className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground">Preset: ETH</button>
          <button type="button" onClick={save} disabled={saving || !form.safeAddress.trim()} className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar config"}
          </button>
        </div>
      </div>

      {/* Status */}
      {setup.config && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Saldo do Safe</div>
            <div className="mt-1 text-sm font-medium text-foreground">{setup.balance != null ? `${setup.balance} ${setup.config.tokenSymbol}` : "—"}</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Proposer é delegate?</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
              {setup.delegateRegistered === true ? (
                <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" /> Registrado</span>
              ) : setup.delegateRegistered === false ? (
                <span className="flex items-center gap-1 text-warning"><XCircle className="h-4 w-4" /> Não registrado</span>
              ) : (
                <span className="text-foreground-faint">—</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Register delegate */}
      {setup.config && setup.proposer && setup.delegateRegistered !== true && (
        <button type="button" onClick={registerAsDelegate} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Conectar carteira (owner) &amp; registrar proposer
        </button>
      )}
      <p className="text-[11px] text-foreground-faint">
        Conecte a carteira de um <strong>owner</strong> do Safe pra assinar o registro do delegate (assinatura off-chain, sem gás, não move fundos). Depois disso, ao concluir um bounty o portal propõe o pagamento no Safe pros owners aprovarem.
      </p>
    </section>
  );
}
