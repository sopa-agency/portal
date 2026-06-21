"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Loader2, Plus, Trash2, Check, KeyRound } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import {
  upsertTrailHiveAccount,
  setTrailAccountEnabled,
  removeTrailAccount,
  startTrailAccountFarcaster,
  finishTrailAccountFarcaster,
  type TrailAccountRow,
} from "@/app/actions/trail-admin";

const KIND_LABEL: Record<string, string> = { company: "empresa", agent: "agente", member: "membro" };

export function TrailAdmin({ initial, sponsorReady }: { initial: TrailAccountRow[]; sponsorReady: boolean }) {
  const [rows, setRows] = useState(initial);
  const [fcFor, setFcFor] = useState<{ id: string; qr: string; url: string } | null>(null);
  const fcPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (fcPoll.current) clearInterval(fcPoll.current); }, []);

  const connectFarcaster = async (row: TrailAccountRow) => {
    setMsg(null);
    const r = await startTrailAccountFarcaster(row.id);
    if (!r.ok) { setMsg({ kind: "err", text: r.error }); return; }
    setFcFor({ id: row.id, qr: r.qr, url: r.approvalUrl });
    fcPoll.current = setInterval(async () => {
      const s = await finishTrailAccountFarcaster(row.id, r.signerUuid);
      if (s.ok && s.status === "approved") {
        if (fcPoll.current) clearInterval(fcPoll.current);
        setFcFor(null);
        setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, hasFcSigner: true, fid: s.fid ?? x.fid } : x)));
        setMsg({ kind: "ok", text: `Farcaster conectado${s.handle ? ` (@${s.handle})` : ""}.` });
      }
    }, 2500);
  };
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", hiveAccount: "", postingKey: "", weight: 100, kind: "member" as "company" | "agent" | "member" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = (updater: (r: TrailAccountRow[]) => TrailAccountRow[]) => setRows(updater);

  const add = async () => {
    setBusy(true); setMsg(null);
    const r = await upsertTrailHiveAccount({
      kind: form.kind,
      label: form.label || form.hiveAccount,
      hiveAccount: form.hiveAccount,
      postingKey: form.postingKey,
      hiveVoteWeight: Math.round(form.weight * 100),
    });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: "err", text: r.error }); return; }
    setMsg({ kind: "ok", text: `@${form.hiveAccount} adicionado ao trail.` });
    setForm({ label: "", hiveAccount: "", postingKey: "", weight: 100, kind: "member" });
    setAdding(false);
    // optimistic: add a row (server is source of truth on reload)
    refresh((rs) => [
      ...rs,
      { id: `tmp-${Date.now()}`, kind: form.kind, label: form.hiveAccount, ownerSlug: null, enabled: true, fid: null, hasFcSigner: false, hiveAccount: form.hiveAccount, hasHiveKey: true, autoLike: true, hiveVoteWeight: Math.round(form.weight * 100), watch: form.kind !== "member" },
    ]);
  };

  const toggle = async (row: TrailAccountRow) => {
    refresh((rs) => rs.map((r) => (r.id === row.id ? { ...r, enabled: !r.enabled } : r)));
    await setTrailAccountEnabled(row.id, !row.enabled);
  };

  const remove = async (row: TrailAccountRow) => {
    refresh((rs) => rs.filter((r) => r.id !== row.id));
    await removeTrailAccount(row.id);
  };

  return (
    <section aria-labelledby="trail-admin-heading" className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 id="trail-admin-heading" className="text-lg font-semibold tracking-tight text-foreground">
          Curation Trail
        </h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">global · admin</span>
        <span className="text-xs text-foreground-faint">{rows.filter((r) => r.enabled).length}/{rows.length} ativas</span>
      </div>
      <p className="mb-4 text-xs text-foreground-muted">
        Contas que engajam entre si. Acumule posting keys de Hive (guardadas <strong className="text-foreground">criptografadas</strong>) pra fortalecer o trail — quanto mais contas, mais upvote/engajamento inicial.
      </p>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface-elevated px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.kind === "company" ? "bg-accent-bg text-accent" : r.kind === "agent" ? "bg-warning/15 text-warning" : "bg-foreground/10 text-foreground-muted"}`}>
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>
              <span className="text-sm font-medium text-foreground">{r.label}</span>
              <div className="flex items-center gap-2 text-[11px] text-foreground-subtle">
                <span className="inline-flex items-center gap-1">
                  <SocialBrandIcon platform="farcaster" className="h-3 w-3" />
                  {r.hasFcSigner ? (r.fid ?? "ok") : <span className="text-foreground-faint">não conectado</span>}
                </span>
                {r.hiveAccount && (
                  <span className="inline-flex items-center gap-1">
                    <SocialBrandIcon platform="hive" className="h-3 w-3" /> @{r.hiveAccount}
                    {r.hasHiveKey ? <KeyRound className="h-3 w-3 text-success" /> : <span className="text-foreground-faint">sem key</span>}
                  </span>
                )}
                <span className="text-foreground-faint">upvote {(r.hiveVoteWeight / 100).toFixed(0)}%</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {!r.hasFcSigner && sponsorReady && r.kind !== "agent" && (
                  <button
                    type="button"
                    onClick={() => connectFarcaster(r)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    <SocialBrandIcon platform="farcaster" className="h-3 w-3" /> conectar FC
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${r.enabled ? "border-success/40 text-success" : "border-border text-foreground-faint"}`}
                >
                  {r.enabled ? "ativa" : "pausada"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  aria-label="Remover"
                  className="rounded-lg border border-border p-1 text-foreground-muted transition-colors hover:border-danger/40 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Inline Farcaster QR for this account */}
            {fcFor?.id === r.id && (
              <div className="mt-2 flex items-center gap-3 rounded-lg border border-accent-border bg-accent-bg/20 p-2.5">
                <Image src={fcFor.qr} alt="QR Farcaster" width={96} height={96} className="rounded border border-border bg-white p-1" unoptimized />
                <div className="min-w-0 text-xs text-foreground-muted">
                  <p>Peça pra @{r.label} escanear (logado no Warpcast) e aprovar. Confirma sozinho.</p>
                  <a href={fcFor.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 underline">abrir link</a>
                  <p className="mt-1 flex items-center gap-1.5 text-foreground-faint"><Loader2 className="h-3 w-3 animate-spin" /> aguardando aprovação…</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-xl border border-accent-border bg-accent-bg/20 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="text-foreground-subtle">Conta Hive</span>
              <input value={form.hiveAccount} onChange={(e) => setForm({ ...form, hiveAccount: e.target.value })} placeholder="ex: bielcx"
                className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none" />
            </label>
            <label className="text-xs">
              <span className="text-foreground-subtle">Tipo</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
                className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent-border focus:outline-none">
                <option value="member">membro</option>
                <option value="company">empresa</option>
                <option value="agent">agente</option>
              </select>
            </label>
          </div>
          <label className="block text-xs">
            <span className="text-foreground-subtle">Posting key (WIF) — guardada criptografada</span>
            <input type="password" value={form.postingKey} onChange={(e) => setForm({ ...form, postingKey: e.target.value })} placeholder="5..."
              autoComplete="off" spellCheck={false}
              className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none" />
          </label>
          <label className="block text-xs">
            <span className="text-foreground-subtle">Peso do upvote: {form.weight}%</span>
            <input type="range" min={1} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} className="mt-1 w-full accent-accent" />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setMsg(null); }} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted hover:border-border-strong">Cancelar</button>
            <button type="button" onClick={add} disabled={busy || !form.hiveAccount.trim() || !form.postingKey.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Adicionar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setAdding(true); setMsg(null); }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-strong">
          <Plus className="h-4 w-4" /> Adicionar conta + posting key
        </button>
      )}

      {msg && (
        <p className={`mt-2 rounded-lg border px-2.5 py-1.5 text-xs ${msg.kind === "ok" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
