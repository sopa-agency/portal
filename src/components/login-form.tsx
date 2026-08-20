"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Loader2 } from "lucide-react";

type State =
  | { kind: "idle" }
  | { kind: "connecting"; msg: string }
  | { kind: "error"; msg: string };

type LoginFormProps = {
  /** Active project display name, e.g. "Reelflip" */
  projectName: string;
  /** Active project logo path under /public */
  logo: string;
  /** Whether GitHub OAuth is configured for this portal. */
  githubEnabled?: boolean;
};

const GITHUB_ERRORS: Record<string, string> = {
  github_unconfigured: "GitHub login não está configurado neste portal.",
  github_state: "Sessão de login expirou. Tente de novo.",
  github_token: "Não foi possível autenticar no GitHub.",
  github_user: "Não foi possível ler seu perfil do GitHub.",
  github_nomember: "Sua conta do GitHub não está vinculada a nenhum membro da equipe. Peça a um admin para cadastrar seu GitHub na aba Team.",
  github_noaccess: "Sua conta não tem acesso a este portal.",
};

export function LoginForm({ projectName, logo, githubEnabled }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("next") || "/";
  const oauthError = params.get("error");
  const [username, setUsername] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const cardRef = useRef<HTMLDivElement>(null);

  const isBusy = state.kind === "connecting";

  // Feeds the card's spotlight (see .auth-card::after). Written straight to the
  // node: this fires on every pointer move, and a state update per frame would
  // re-render the whole form for a decoration. Mouse only — on touch there is no
  // hover, so the highlight would just stick wherever the last tap landed.
  const trackPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  const connect = async () => {
    const cleaned = username.toLowerCase().trim().replace(/^@/, "");
    if (!cleaned) {
      setState({ kind: "error", msg: "Enter your Hive username." });
      return;
    }

    setState({ kind: "connecting", msg: "Checking Keychain…" });

    // The extension injects window.hive_keychain on load. Polling is more
    // reliable than the SDK's isKeychainInstalled(). On Brave + some Chromium
    // builds the injection can take several seconds, so wait up to 10s.
    const hasKeychain = await new Promise<boolean>((resolve) => {
      const w = window as unknown as { hive_keychain?: unknown };
      if (w.hive_keychain) return resolve(true);
      let elapsed = 0;
      const step = 100;
      const timeout = 10_000;
      const timer = setInterval(() => {
        if (w.hive_keychain) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        elapsed += step;
        if (elapsed >= timeout) {
          clearInterval(timer);
          resolve(false);
        }
      }, step);
    });

    if (!hasKeychain) {
      setState({
        kind: "error",
        msg: "Hive Keychain extension not detected after 10s. If installed and unlocked, click the Keychain icon in your browser toolbar to make sure it has access to this site, then refresh.",
      });
      return;
    }

    // Lazy-load keychain-sdk for the signBuffer call
    let KeychainSDK: typeof import("keychain-sdk").KeychainSDK;
    let KeychainKeyTypes: typeof import("keychain-sdk").KeychainKeyTypes;
    try {
      const mod = await import("keychain-sdk");
      KeychainSDK = mod.KeychainSDK;
      KeychainKeyTypes = mod.KeychainKeyTypes;
    } catch (err) {
      setState({
        kind: "error",
        msg: "Couldn't load Keychain SDK: " + (err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    const keychain = new KeychainSDK(window);

    setState({ kind: "connecting", msg: "Requesting challenge…" });
    let nonce: string;
    try {
      const r = await fetch("/api/auth/challenge", { method: "POST" });
      const j = await r.json();
      if (!r.ok || typeof j.nonce !== "string") throw new Error(j.error || "Challenge failed");
      nonce = j.nonce;
    } catch (err) {
      setState({
        kind: "error",
        msg: "Challenge fetch failed: " + (err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    setState({ kind: "connecting", msg: `Open Keychain and approve as @${cleaned}…` });
    let signResult;
    try {
      signResult = await keychain.signBuffer({
        username: cleaned,
        message: nonce,
        method: KeychainKeyTypes.posting,
      });
    } catch (err) {
      setState({
        kind: "error",
        msg: "Keychain error: " + (err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    if (!signResult?.success || !signResult.result) {
      setState({
        kind: "error",
        msg: signResult?.error || "Keychain rejected the signature.",
      });
      return;
    }

    setState({ kind: "connecting", msg: "Verifying signature…" });
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: cleaned, signature: signResult.result }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Login failed");
    } catch (err) {
      setState({
        kind: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  };

  return (
    <div className="auth-scene flex min-h-screen items-center justify-center px-4">
      {/* Decoration only — the scene behind the card. */}
      <div className="auth-grid" aria-hidden="true" />
      <span className="auth-aura auth-aura-a" aria-hidden="true" />
      <span className="auth-aura auth-aura-b" aria-hidden="true" />

      <div
        ref={cardRef}
        onPointerMove={trackPointer}
        className="auth-card w-full max-w-sm rounded-2xl px-6 py-8"
      >
        <div className="flex flex-col items-center text-center">
          <span className="auth-logo mb-3 inline-flex">
            <Image src={logo} alt={projectName} width={56} height={56} priority />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-accent">portal · {projectName}</h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-foreground-subtle">
            internal ops
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              Hive username
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              placeholder="vladnikolaev"
              autoComplete="username"
              spellCheck={false}
              disabled={isBusy}
              className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground transition-colors placeholder:text-foreground-faint hover:border-border-strong focus:border-accent-border focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>

          <button
            type="button"
            onClick={connect}
            disabled={isBusy}
            className="auth-action flex w-full items-center justify-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-4 py-2.5 text-sm font-medium text-accent hover:border-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect with Hive Keychain
          </button>

          {githubEnabled && (
            <>
              <div className="flex items-center gap-2 py-0.5 text-[10px] uppercase tracking-widest text-foreground-faint">
                <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
              </div>
              <a
                href={`/api/auth/github/start?next=${encodeURIComponent(redirectTo)}`}
                className="auth-action flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-elevated px-4 py-2.5 text-sm font-medium text-foreground hover:border-border-strong"
              >
                <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                Entrar com GitHub
              </a>
            </>
          )}
        </div>

        {oauthError && state.kind !== "error" && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {GITHUB_ERRORS[oauthError] ?? "Falha no login."}
          </p>
        )}

        {state.kind === "connecting" && (
          <p className="mt-4 text-center text-xs text-foreground-muted">{state.msg}</p>
        )}
        {state.kind === "error" && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {state.msg}
          </p>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-foreground-faint">
          Portal access is gated. Only allowlisted Hive accounts can log in. Need access? Ask
          @xvlad.
        </p>
      </div>
    </div>
  );
}
