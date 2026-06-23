"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { ExternalLink, Loader2, Send, RefreshCw, Heart, Rocket, ChevronDown, Check } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { listSnapsForCuration, replyToSnap, boostSnap } from "@/app/actions/snap-curation";
import { BOOST_LEVELS, type CurationSnap, type BoostLevel } from "@/lib/snap-curation-shared";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function SnapsInbox() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [snaps, setSnaps] = useState<CurationSnap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloading, startReload] = useTransition();

  function load() {
    startReload(async () => {
      const res = await listSnapsForCuration();
      if (res.ok) { setSnaps(res.snaps); setStatus("ready"); }
      else { setError(res.error); setStatus("error"); }
    });
  }
  useEffect(() => { load(); }, []);

  const patch = (id: string, next: Partial<CurationSnap>) =>
    setSnaps((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)));

  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando snaps da SkateHive…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-4 text-sm">
        <p className="font-medium text-foreground">Não consegui carregar os snaps.</p>
        <p className="mt-1 text-foreground-muted">{error}</p>
        <button type="button" onClick={load} disabled={reloading} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-foreground-faint">
          <SocialBrandIcon platform="hive" className="h-3.5 w-3.5" /> snaps recentes da comunidade · responda ou impulsione
        </p>
        <button type="button" onClick={load} disabled={reloading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground-muted hover:border-border-strong disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>
      {snaps.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-faint">Nenhum snap recente.</p>
      ) : (
        <ul className="space-y-2.5">
          {snaps.map((s) => (
            <SnapRow key={s.id} snap={s} onPatch={(p) => patch(s.id, p)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SnapRow({ snap, onPatch }: { snap: CurationSnap; onPatch: (p: Partial<CurationSnap>) => void }) {
  const [text, setText] = useState("");
  const [replied, setReplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const reply = () =>
    startBusy(async () => {
      setError(null);
      const res = await replyToSnap(snap.author, snap.permlink, text);
      if (res.ok) { setReplied(res.url); setText(""); }
      else setError(res.error);
    });

  return (
    <li className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={snap.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-accent">
            <span className="font-semibold">@{snap.author}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-foreground-subtle" />
          </a>
          {snap.title && <p className="mt-0.5 line-clamp-2 text-sm text-foreground-muted">{snap.title}</p>}
          <p className="mt-1 flex items-center gap-3 text-[11px] tabular-nums text-foreground-faint">
            <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" /> {snap.votes}</span>
            <span>{usd(snap.payout)}</span>
            {snap.boost && (
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${snap.boost.status === "active" ? "bg-accent-bg text-accent" : "bg-success/15 text-success"}`}>
                <Rocket className="h-3 w-3" /> boost {snap.boost.released}/{snap.boost.budget}
              </span>
            )}
          </p>
        </div>
        <BoostButton snap={snap} onBoosted={(b) => onPatch({ boost: b })} />
      </div>

      {replied ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Comentário postado. <a href={replied} target="_blank" rel="noreferrer" className="underline">ver</a>
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) reply(); }}
            placeholder="Comentar no snap…"
            maxLength={500}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
          />
          <button type="button" onClick={reply} disabled={busy || !text.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Responder
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </li>
  );
}

function BoostButton({ snap, onBoosted }: { snap: CurationSnap; onBoosted: (b: CurationSnap["boost"]) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = snap.boost?.status === "active";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const doBoost = (level: BoostLevel) =>
    startBusy(async () => {
      setError(null);
      setOpen(false);
      const res = await boostSnap(snap.author, snap.permlink, level, snap.votes);
      if (res.ok) onBoosted({ budget: res.budget, released: 0, status: "active" });
      else setError(res.error);
    });

  return (
    <div ref={ref} className="relative shrink-0">
      <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-accent-border">
        <button
          type="button"
          onClick={() => doBoost("medium")}
          disabled={busy || active}
          className="inline-flex items-center gap-1.5 bg-accent-bg px-2.5 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
          title={active ? "Já impulsionado" : "Impulsionar (Médio)"}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {active ? "Impulsionando" : "Boost"}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy || active}
          aria-label="Opções de boost"
          aria-expanded={open}
          className="border-l border-accent-border bg-accent-bg px-1.5 text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-xl">
          <p className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-foreground-subtle">Hiveboost</p>
          {BOOST_LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => doBoost(l.value)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent-bg"
            >
              <span className="flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5 text-accent" /> {l.label}</span>
              <span className="text-[11px] text-foreground-faint">{l.hint}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="absolute right-0 mt-1 w-44 text-right text-[10px] text-danger">{error}</p>}
    </div>
  );
}
