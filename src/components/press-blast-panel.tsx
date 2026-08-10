"use client";

// Press Blast panel — shown under the campaign's Press Release doc. Manage a
// crypto-media contact list and blast the release to them (test + confirm
// guarded). Copy is PT-BR. Theme-aware (semantic tokens).

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, Send, Plus, X, AlertTriangle, Megaphone, CheckCircle2 } from "lucide-react";
import {
  getPressBlast,
  addPressContact,
  removePressContact,
  blastPressRelease,
  type PressBlastState,
} from "@/app/actions/press-blast";

export function PressBlastPanel({ campaignId, documentId }: { campaignId: string; documentId: string }) {
  const [state, setState] = useState<PressBlastState | null>(null);
  const [outlet, setOutlet] = useState("");
  const [email, setEmail] = useState("");
  const [testTo, setTestTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(() => {
    getPressBlast(campaignId).then(setState).catch(() => {});
  }, [campaignId]);
  useEffect(() => {
    load();
  }, [load]);

  const add = () => {
    if (!email.trim()) return;
    setMsg(null);
    start(async () => {
      const r = await addPressContact(campaignId, outlet, email);
      if (r.ok) {
        setOutlet("");
        setEmail("");
        load();
      } else setMsg({ ok: false, text: r.error ?? "Falha." });
    });
  };
  const remove = (id: string) => start(async () => { await removePressContact(id); load(); });

  const test = () => {
    if (!testTo.trim()) return;
    setMsg(null);
    start(async () => {
      const r = await blastPressRelease(campaignId, documentId, { testTo });
      setMsg(r.ok ? { ok: true, text: `Teste enviado para ${testTo}.` } : { ok: false, text: r.error });
    });
  };

  const blast = () => {
    setMsg(null);
    setConfirming(false);
    start(async () => {
      const r = await blastPressRelease(campaignId, documentId);
      if (r.ok) {
        setMsg({ ok: true, text: `Enviado: ${r.sent} · falhas: ${r.failed}.` });
        load();
      } else setMsg({ ok: false, text: r.error });
    });
  };

  const pendingCount = state?.contacts.filter((c) => c.status !== "sent").length ?? 0;
  const chip = (s: string) =>
    s === "sent"
      ? "bg-success/15 text-success"
      : s === "failed"
      ? "bg-danger/15 text-danger"
      : "bg-surface-elevated text-foreground-muted";

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Press Blast</h3>
        <span className="text-[11px] text-foreground-faint">— enviar pra mídia cripto (Bankless, BeInCrypto…)</span>
      </div>

      {state && !state.emailConfigured && (
        <p className="mb-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> Email não configurado pra esse projeto — não dá pra enviar ainda.
        </p>
      )}
      {state && state.emailConfigured && !state.ownMailbox && (
        <p className="mb-2 text-[11px] text-foreground-faint">
          Enviando pela caixa do SkateHive (o remetente não é @gnars). Configure <span className="font-mono">GNARS_EMAIL_*</span> pra usar a caixa da Gnars.
        </p>
      )}

      {/* Contacts */}
      <div className="divide-y divide-border rounded-lg border border-border">
        {state?.contacts.length ? (
          state.contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
              <span className="w-24 shrink-0 truncate font-medium text-foreground">{c.outlet}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-foreground-muted">{c.email}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip(c.status)}`}>{c.status}</span>
              <button type="button" onClick={() => remove(c.id)} disabled={pending} className="text-foreground-faint hover:text-danger">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        ) : (
          <p className="px-2.5 py-3 text-center text-[11px] text-foreground-faint">Nenhum contato ainda — adicione os veículos abaixo.</p>
        )}
      </div>

      {/* Add contact */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <input value={outlet} onChange={(e) => setOutlet(e.target.value)} placeholder="Veículo (ex: Bankless)"
          className="w-32 rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11px] text-foreground placeholder:text-foreground-faint" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tips@bankless.com" type="email"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11px] text-foreground placeholder:text-foreground-faint" />
        <button type="button" onClick={add} disabled={pending || !email.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-foreground/5 disabled:opacity-40">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {/* Test + blast */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="teu@email pra teste" type="email"
          className="w-44 rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11px] text-foreground placeholder:text-foreground-faint" />
        <button type="button" onClick={test} disabled={pending || !testTo.trim() || !state?.emailConfigured}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-[11px] text-foreground-muted transition hover:text-foreground disabled:opacity-40">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Teste
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {confirming ? (
            <>
              <span className="text-[11px] text-foreground-muted">Enviar pra {pendingCount}?</span>
              <button type="button" onClick={blast} disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 text-[11px] font-semibold text-danger transition hover:bg-danger/20 disabled:opacity-40">
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Megaphone className="h-3 w-3" />} Confirmar blast
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-[11px] text-foreground-faint hover:text-foreground">cancelar</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} disabled={pending || pendingCount === 0 || !state?.emailConfigured}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-3 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40">
              <Megaphone className="h-3.5 w-3.5" /> Blastar ({pendingCount})
            </button>
          )}
        </div>
      </div>

      {msg && (
        <p className={`mt-2 flex items-center gap-1.5 text-[11px] ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {msg.text}
        </p>
      )}
    </section>
  );
}
