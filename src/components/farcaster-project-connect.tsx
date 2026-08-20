"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Check, ExternalLink, RefreshCw } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";

// Connect the ACTIVE PROJECT's brand Farcaster account via a sponsor-minted
// approval QR (no Neynar client_id needed). Mint → show QR/deep link → poll
// until the admin approves in the brand's Warpcast → the /status route persists
// it to farcasterSigner[project]. Handles pending / approved / expired: an
// abandoned attempt writes nothing, and "gerar novo QR" re-mints at any time.

type Phase =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "awaiting"; qr: string; url: string; signer: string; stale: boolean }
  | { kind: "done"; handle?: string | null }
  | { kind: "error"; msg: string };

export function FarcasterProjectConnect({
  projectName,
  sponsorReady,
  initial,
}: {
  projectName: string;
  sponsorReady: boolean;
  initial: { connected: boolean; handle: string | null };
}) {
  const [phase, setPhase] = useState<Phase>(
    initial.connected ? { kind: "done", handle: initial.handle } : { kind: "idle" },
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => stopPoll, []);

  const connect = async () => {
    stopPoll();
    setPhase({ kind: "minting" });
    try {
      const res = await fetch("/api/farcaster/project-signer/start", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Falha ao gerar QR (HTTP ${res.status}).`);
      setPhase({ kind: "awaiting", qr: j.qr, url: j.approval_url, signer: j.signer_uuid, stale: false });
      let ticks = 0;
      pollRef.current = setInterval(async () => {
        ticks += 1;
        try {
          const r = await fetch(`/api/farcaster/project-signer/status?signer_uuid=${encodeURIComponent(j.signer_uuid)}`);
          const s = (await r.json().catch(() => ({}))) as { status?: string; handle?: string };
          if (s.status === "approved") {
            stopPoll();
            setPhase({ kind: "done", handle: s.handle ?? null });
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        // ~4 min without approval: nudge to re-mint (but keep polling the old one).
        if (ticks >= 96) setPhase((p) => (p.kind === "awaiting" && !p.stale ? { ...p, stale: true } : p));
      }, 2500);
    } catch (e) {
      setPhase({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const disconnect = async () => {
    stopPoll();
    await fetch("/api/auth/farcaster/connect", { method: "DELETE" }).catch(() => {});
    setPhase({ kind: "idle" });
  };

  return (
    <section aria-labelledby="brand-fc-heading" className="rounded-2xl border border-accent-border bg-accent-bg/20 p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <SocialBrandIcon platform="farcaster" className="h-4 w-4 shrink-0" />
        <h2 id="brand-fc-heading" className="text-base font-semibold text-foreground">Farcaster da marca</h2>
        <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          {projectName} · admin
        </span>
      </div>
      <p className="mb-3 text-xs text-foreground-muted">
        Conecta a conta oficial de Farcaster desta marca pra publicar casts pelo portal. Você aprova no Warpcast logado como a marca — nada de copiar chaves.
      </p>

      {!sponsorReady ? (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs leading-relaxed text-foreground-muted">
          Conexão por QR indisponível neste ambiente (falta a conta sponsor: <code className="font-mono">FARCASTER_SPONSOR_MNEMONIC</code> / <code className="font-mono">_FID</code>).
        </p>
      ) : phase.kind === "done" ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" /> Conectado{phase.handle ? ` como @${phase.handle}` : ""}. Pronto pra publicar.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={connect} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong">
              Reconectar
            </button>
            <button type="button" onClick={disconnect} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong">
              Desconectar
            </button>
          </div>
        </div>
      ) : phase.kind === "awaiting" ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-foreground-muted">
            Abra no celular logado no Warpcast <strong className="text-foreground">da marca</strong> e aprove. A página confirma sozinha. O link expira em 24h.
          </p>
          <div className="flex flex-col items-center gap-2">
            <Image src={phase.qr} alt="QR de aprovação do Farcaster" width={200} height={200} className="rounded-lg border border-border bg-white p-2" unoptimized />
            <a href={phase.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-foreground-subtle underline transition hover:text-foreground">
              abrir link de aprovação <ExternalLink className="h-3 w-3" />
            </a>
            <p className="flex items-center gap-1.5 text-xs text-foreground-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> aguardando aprovação…
            </p>
            {phase.stale && <p className="text-xs text-warning">Demorou? O link pode ter expirado — gere um novo QR.</p>}
            <button type="button" onClick={connect} className="inline-flex items-center gap-1 text-xs text-foreground-subtle underline transition hover:text-foreground">
              <RefreshCw className="h-3 w-3" /> gerar novo QR
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={connect}
            disabled={phase.kind === "minting"}
            className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {phase.kind === "minting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SocialBrandIcon platform="farcaster" className="h-4 w-4" />}
            Conectar Farcaster via QR
          </button>
          {phase.kind === "error" && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{phase.msg}</p>
          )}
        </div>
      )}
    </section>
  );
}
