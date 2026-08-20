"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, AlertCircle } from "lucide-react";

// "Conectar Farcaster" — Sign In With Neynar (SIWN). The widget authenticates
// the brand's Farcaster account and returns an APPROVED signer_uuid; we hand it
// to /api/auth/farcaster/connect which verifies it server-side and stores it.
// One connect = both reading (fid/handle) and posting (signer) for this portal.
//
// Requires NEYNAR_CLIENT_ID (public) with the portal domains added to the
// Neynar app's "Authorized origins". Without it, nothing renders.

type SiwnData = { signer_uuid?: string; fid?: number };

declare global {
  interface Window {
    // SIWN invokes this global by name (data-success-callback).
    onFarcasterSignInSuccess?: (data: SiwnData) => void;
  }
}

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; handle?: string | null }
  | { kind: "error"; msg: string };

export function FarcasterConnectButton({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId) return;

    window.onFarcasterSignInSuccess = async (data: SiwnData) => {
      if (!data?.signer_uuid) {
        setState({ kind: "error", msg: "A Neynar não retornou um signer." });
        return;
      }
      setState({ kind: "saving" });
      try {
        const res = await fetch("/api/auth/farcaster/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signer_uuid: data.signer_uuid, fid: data.fid }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `Falha ao salvar (HTTP ${res.status}).`);
        setState({ kind: "done", handle: j.username });
        router.refresh();
      } catch (err) {
        setState({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
      }
    };

    // Load the SIWN widget script once.
    const SRC = "https://neynarxyz.github.io/siwn/raw.js";
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SRC;
      script.async = true;
      document.body.appendChild(script);
    }

    return () => {
      delete window.onFarcasterSignInSuccess;
    };
  }, [clientId, router]);

  if (!clientId) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs leading-relaxed text-foreground-muted">
        Para habilitar o botão <strong>Conectar Farcaster</strong>, defina <code className="font-mono">NEYNAR_CLIENT_ID</code> (público)
        e adicione os domínios do portal em <em>Authorized origins</em> no painel da Neynar.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-accent-border bg-accent-bg/40 p-3.5">
      <p className="text-xs leading-relaxed text-foreground-muted">
        Conecte a conta de Farcaster da marca uma vez — habilita leitura (métricas) e publicação (casts) neste portal. Você aprova no Warpcast; nada de copiar chaves.
      </p>

      {/* SIWN widget mount — the script upgrades this div into the button. */}
      <div
        ref={mountRef}
        className="neynar_signin"
        data-client_id={clientId}
        data-success-callback="onFarcasterSignInSuccess"
        data-theme="dark"
        data-variant="farcaster"
      />

      {state.kind === "saving" && (
        <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando signer…
        </p>
      )}
      {state.kind === "done" && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Conectado{state.handle ? ` como @${state.handle}` : ""}. Pode fechar.
        </p>
      )}
      {state.kind === "error" && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {state.msg}
        </p>
      )}
    </div>
  );
}
