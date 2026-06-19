"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Copy, Wallet, ChevronDown } from "lucide-react";
import { createWalletClient, custom } from "viem";
import {
  getBountySetup,
  saveBountyConfig,
  getDelegateSignPayload,
  registerDelegate,
  type ProjectBounty,
} from "@/app/actions/bounty";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export function BountySetup() {
  const [proposer, setProposer] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectBounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await getBountySetup();
    setLoading(false);
    if (r.ok) { setProposer(r.proposer); setProjects(r.projects); }
    else setErr(r.error);
  }
  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-sm text-foreground-muted"><Loader2 className="inline h-4 w-4 animate-spin" /> Carregando bounty setup…</p>;

  return (
    <section aria-labelledby="bounty-heading" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 id="bounty-heading" className="text-lg font-semibold tracking-tight text-foreground">Bounties &amp; Safe</h2>
        <span className="text-xs text-foreground-faint">cada projeto paga do seu Safe — config por projeto</span>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Proposer (delegate de cada Safe — só propõe)</div>
        {proposer ? (
          <button type="button" onClick={() => navigator.clipboard?.writeText(proposer)} title="Copiar" className="mt-1 flex w-full items-center gap-1.5 truncate font-mono text-xs text-accent hover:underline">
            <Copy className="h-3 w-3 shrink-0" /> {proposer}
          </button>
        ) : (
          <p className="mt-1 text-xs text-danger">SAFE_PROPOSER_PRIVATE_KEY não configurado.</p>
        )}
      </div>

      <div className="space-y-2">
        {projects.map((p) => (
          <ProjectBountyRow
            key={p.slug}
            project={p}
            proposer={proposer}
            isOpen={open === p.slug}
            onToggle={() => setOpen(open === p.slug ? null : p.slug)}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectBountyRow({
  project,
  proposer,
  isOpen,
  onToggle,
  onChanged,
}: {
  project: ProjectBounty;
  proposer: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const c = project.config;
  const [form, setForm] = useState({
    safeAddress: c?.safeAddress ?? "",
    chainId: c?.chainId ?? 8453,
    tokenAddress: c?.tokenAddress ?? "",
    tokenSymbol: c?.tokenSymbol ?? "ETH",
    tokenDecimals: c?.tokenDecimals ?? 18,
  });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true); setMsg(null);
    const r = await saveBountyConfig(project.slug, { ...form, tokenAddress: form.tokenAddress.trim() || null });
    setSaving(false);
    if (r.ok) { setMsg({ ok: true, text: "Salvo ✅" }); await onChanged(); }
    else setMsg({ ok: false, text: r.error });
  }

  async function registerAsDelegate() {
    setBusy(true); setMsg(null);
    try {
      const payload = await getDelegateSignPayload(project.slug);
      if (!payload.ok) { setMsg({ ok: false, text: payload.error }); return; }
      const eth = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!eth) { setMsg({ ok: false, text: "Carteira não detectada (MetaMask/Rabby)." }); return; }
      const wc = createWalletClient({ transport: custom(eth as Parameters<typeof custom>[0]) });
      const [delegator] = await wc.requestAddresses();
      const signature = await wc.signTypedData({
        account: delegator,
        domain: payload.domain as Record<string, unknown>,
        types: payload.types as Record<string, { name: string; type: string }[]>,
        primaryType: payload.primaryType,
        message: payload.message as Record<string, unknown>,
      });
      const r = await registerDelegate(project.slug, delegator, signature);
      if (r.ok) { setMsg({ ok: true, text: "Delegate registrado ✅" }); await onChanged(); }
      else setMsg({ ok: false, text: r.error });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Falha ao assinar." });
    } finally { setBusy(false); }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-elevated">
        <span className="text-sm font-semibold text-foreground">{project.name}</span>
        <span className="flex items-center gap-2 text-xs">
          {c ? (
            <>
              <span className="text-foreground-muted">{project.balance != null ? `${project.balance} ${c.tokenSymbol}` : "—"}</span>
              {project.delegateRegistered === true ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-warning" />}
            </>
          ) : (
            <span className="text-foreground-faint">sem Safe</span>
          )}
          <ChevronDown className={`h-4 w-4 text-foreground-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t border-border p-3">
          {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
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
          <label className="block text-xs text-foreground-muted">Token address (vazio = ETH)
            <input value={form.tokenAddress} onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })} placeholder="0x… ou vazio" className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setForm({ ...form, chainId: 8453, tokenAddress: USDC_BASE, tokenSymbol: "USDC", tokenDecimals: 6 })} className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground">USDC (Base)</button>
            <button type="button" onClick={() => setForm({ ...form, chainId: 1, tokenAddress: USDC_ETH, tokenSymbol: "USDC", tokenDecimals: 6 })} className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground">USDC (Ethereum)</button>
            <button type="button" onClick={() => setForm({ ...form, tokenAddress: "", tokenSymbol: "ETH", tokenDecimals: 18 })} className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground">ETH</button>
            <button type="button" onClick={save} disabled={saving || !form.safeAddress.trim()} className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
            </button>
          </div>
          {c && proposer && project.delegateRegistered !== true && (
            <button type="button" onClick={registerAsDelegate} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} Conectar carteira (owner) &amp; registrar proposer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
