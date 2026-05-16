"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Loader2 } from "lucide-react";

type State =
  | { kind: "idle" }
  | { kind: "connecting"; msg: string }
  | { kind: "error"; msg: string };

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("next") || "/";
  const [username, setUsername] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const isBusy = state.kind === "connecting";

  const connect = async () => {
    const cleaned = username.toLowerCase().trim().replace(/^@/, "");
    if (!cleaned) {
      setState({ kind: "error", msg: "Enter your Hive username." });
      return;
    }

    setState({ kind: "connecting", msg: "Checking Keychain…" });

    // The extension injects window.hive_keychain on load. The SDK's
    // isKeychainInstalled() can be flaky, so we poll for the global directly.
    const hasKeychain = await new Promise<boolean>((resolve) => {
      const w = window as unknown as { hive_keychain?: unknown };
      if (w.hive_keychain) return resolve(true);
      let elapsed = 0;
      const step = 100;
      const timer = setInterval(() => {
        if (w.hive_keychain) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        elapsed += step;
        if (elapsed >= 3000) {
          clearInterval(timer);
          resolve(false);
        }
      }, step);
    });

    if (!hasKeychain) {
      setState({
        kind: "error",
        msg: "Hive Keychain extension not detected. Install it from hive-keychain.com, unlock it, then refresh.",
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface px-6 py-8 shadow-xl">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/skatehive-logo.svg"
            alt="SkateHive"
            width={56}
            height={56}
            className="mb-3"
            priority
          />
          <h1 className="text-xl font-bold tracking-tight text-accent">portal · skatehive</h1>
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
              className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </label>

          <button
            type="button"
            onClick={connect}
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-4 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect with Hive Keychain
          </button>
        </div>

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
