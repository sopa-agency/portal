"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Check, ExternalLink } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { disconnectMyFarcaster, type MyFarcaster } from "@/app/actions/farcaster-member";

type Phase =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "awaiting"; qr: string; url: string; signer: string }
  | { kind: "done"; handle?: string | null }
  | { kind: "error"; msg: string };

export function MyFarcasterCard({ initial }: { initial: MyFarcaster }) {
  const [phase, setPhase] = useState<Phase>(
    initial.connected ? { kind: "done", handle: initial.handle } : { kind: "idle" },
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const connect = async () => {
    setPhase({ kind: "minting" });
    try {
      const res = await fetch("/api/farcaster/member-signer/start", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Falha ao gerar QR.");
      setPhase({ kind: "awaiting", qr: j.qr, url: j.approval_url, signer: j.signer_uuid });
      // poll for approval
      pollRef.current = setInterval(async () => {
        const r = await fetch(`/api/farcaster/member-signer/status?signer_uuid=${encodeURIComponent(j.signer_uuid)}`);
        const s = await r.json().catch(() => ({}));
        if (s.status === "approved") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase({ kind: "done", handle: s.handle });
        }
      }, 2500);
    } catch (e) {
      setPhase({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const disconnect = async () => {
    await disconnectMyFarcaster();
    setPhase({ kind: "idle" });
  };

  return (
    <section aria-labelledby="my-fc-heading" className="rounded-2xl border border-accent-border bg-accent-bg/20 p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 id="my-fc-heading" className="text-base font-semibold text-foreground">
          Minhas contas no trail
        </h2>
        <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">você · membro</span>
      </div>
      <p className="mb-3 text-xs text-foreground-muted">
        Suas contas pessoais pra ajudar no engajamento. As contas das marcas (skatehive, gnars, reelflip) são geridas por admins em <strong className="text-foreground">Connections</strong>, abaixo.
      </p>

      {/* Hive — already connected via the member's Keychain login. */}
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <SocialBrandIcon platform="hive" className="h-4 w-4 shrink-0" />
        <span className="text-sm text-foreground">Hive</span>
        {initial.username ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> @{initial.username} (login)
          </span>
        ) : (
          <span className="ml-auto text-xs text-foreground-faint">faça login com Keychain</span>
        )}
      </div>

      {/* Farcaster — connect via QR. */}
      <div className="mb-2 flex items-center gap-2">
        <SocialBrandIcon platform="farcaster" className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium text-foreground">Farcaster</span>
      </div>

      {!initial.sponsorReady ? (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs leading-relaxed text-foreground-muted">
          Conexão de Farcaster por membro ainda não habilitada neste ambiente (falta a conta sponsor).
          Peça a @xvlad pra configurar.
        </p>
      ) : phase.kind === "done" ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" /> Conectado{phase.handle ? ` como @${phase.handle}` : ""}.
          </p>
          <p className="text-xs text-foreground-muted">
            Sua conta está no trail de curadoria — você participa do like/reply entre as marcas.
          </p>
          <button
            type="button"
            onClick={disconnect}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong"
          >
            Desconectar
          </button>
        </div>
      ) : phase.kind === "awaiting" ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-foreground-muted">
            Escaneie com o celular (logado no seu Warpcast) e aprove. A página confirma sozinha.
          </p>
          <div className="flex flex-col items-center gap-2">
            <Image src={phase.qr} alt="QR de aprovação do Farcaster" width={200} height={200} className="rounded-lg border border-border bg-white p-2" unoptimized />
            <a
              href={phase.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-foreground-subtle underline transition-colors hover:text-foreground"
            >
              abrir link de aprovação <ExternalLink className="h-3 w-3" />
            </a>
            <p className="flex items-center gap-1.5 text-xs text-foreground-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> aguardando aprovação…
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-foreground-muted">
            Conecte sua conta do Farcaster pra entrar no trail de curadoria. Você aprova no seu próprio
            Warpcast — não compartilha senha nem seed.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={phase.kind === "minting"}
            className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {phase.kind === "minting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SocialBrandIcon platform="farcaster" className="h-4 w-4" />}
            Conectar meu Farcaster
          </button>
          {phase.kind === "error" && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{phase.msg}</p>
          )}
        </div>
      )}
    </section>
  );
}
