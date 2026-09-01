"use client";

// O perfil no rodapé da barra lateral.
//
// Antes era um avatar, um @nome e um ícone de sair — e mais nada. A carteira
// ficava espalhada: cada card que precisava assinar tinha o seu próprio botão
// "Conectar", e nenhum deles sabia do outro. O lugar da identidade é aqui, junto
// do resto dela: quem você é no portal, e com qual carteira você está operando.
//
// O que este menu responde, nesta ordem:
//   1. quem está logado
//   2. qual carteira está conectada — e se ela é a MESMA que está no cadastro
//      do Team. Essa comparação é o motivo de o menu existir: "conectado" com
//      um endereço na tela não avisa ninguém de que a MetaMask está na conta
//      errada. Com o cadastro do lado, avisa.
//   3. sair
//
// Desconectar aqui ESQUECE, não revoga: a autorização vive na carteira e só ela
// pode tirar. O menu diz isso em vez de deixar a pessoa achar que revogou.

import { useEffect, useRef, useState } from "react";
import { Check, Copy, LogOut, Plug, Wallet } from "lucide-react";
import { useT } from "@/components/locale-provider";
import { useWallet } from "@/components/wallet-provider";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function SidebarProfile({
  username,
  avatarUrl,
  registeredWallet,
  collapsed,
  pending,
  onLogout,
}: {
  username: string;
  avatarUrl: string | null;
  /** A carteira que a pessoa cadastrou no Team. null = não cadastrou. */
  registeredWallet: string | null;
  collapsed: boolean;
  pending: boolean;
  onLogout: () => void;
}) {
  const t = useT().nav;
  const p = t.profile;
  const { address, available, connecting, error, connect, forget } = useWallet();
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fechar clicando fora e no Esc — mesmo comportamento do seletor de portal
  // logo acima, para o menu não ser a única coisa da barra que gruda na tela.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const registered = registeredWallet?.trim().toLowerCase() || null;
  // Três situações diferentes, e cada uma merece uma frase diferente. Juntar
  // "não cadastrou" com "cadastrou outra" esconderia justamente o caso que
  // importa — o da conta errada.
  const match: "same" | "different" | "unregistered" | null = !address
    ? null
    : !registered
      ? "unregistered"
      : registered === address
        ? "same"
        : "different";

  const avatar =
    avatarUrl && !avatarFailed ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        width={32}
        height={32}
        onError={() => setAvatarFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full border border-border object-cover"
      />
    ) : (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-bold uppercase text-accent">
        {username.slice(0, 2)}
      </div>
    );

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sem permissão de área de transferência: o endereço segue na tela */
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={collapsed ? `@${username}` : undefined}
        className={`flex w-full items-center gap-3 rounded-lg py-1.5 text-left transition-colors hover:bg-foreground/5 ${
          collapsed ? "px-2 lg:flex-col lg:gap-2 lg:px-0" : "px-2"
        }`}
      >
        <span className="relative shrink-0">
          {avatar}
          {/* Um ponto, não uma frase: na barra recolhida é o único jeito de a
              carteira conectada continuar visível. */}
          {address && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                match === "different" ? "bg-warning" : "bg-success"
              }`}
            />
          )}
        </span>
        <span className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
          <span className="block truncate text-sm font-medium text-foreground">@{username}</span>
          {/* Endereço em mono e SEM uppercase: "0XDEAD…BEEF" não é um endereço,
              é um endereço estragado. O rótulo "conectado" segue em versalete. */}
          {address ? (
            <span className="block truncate font-mono text-[10px] tracking-tight text-foreground-faint">
              {short(address)}
            </span>
          ) : (
            <span className="block truncate text-[10px] uppercase tracking-wider text-foreground-faint">
              {t.connected}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          {/* Só o nome. O "conectado" já está no gatilho logo abaixo, e repetir a
              mesma linha duas vezes a 8px de distância não informa ninguém —
              aqui o cabeçalho existe para a barra RECOLHIDA, onde o gatilho
              mostra só o avatar. */}
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-foreground">@{username}</p>
          </div>

          <div className="border-b border-border px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
              <Wallet className="h-3 w-3" /> {p.wallet}
            </p>

            {address ? (
              <>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="font-mono text-xs text-foreground">{short(address)}</span>
                  <button
                    type="button"
                    onClick={copy}
                    aria-label={p.copy}
                    className="rounded p-1 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
                <p
                  className={`mt-1 text-[11px] leading-snug ${
                    match === "different" ? "text-warning" : "text-foreground-subtle"
                  }`}
                >
                  {match === "same"
                    ? p.matchesTeam
                    : match === "different"
                      ? p.differsFromTeam(short(registered!))
                      : p.notRegistered}
                </p>
                <button
                  type="button"
                  onClick={forget}
                  className="mt-2 text-[11px] font-medium text-foreground-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  {p.disconnect}
                </button>
                <p className="mt-1 text-[10px] leading-snug text-foreground-faint">{p.forgetNote}</p>
              </>
            ) : available ? (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
              >
                <Plug className="h-3.5 w-3.5" /> {connecting ? p.connecting : p.connect}
              </button>
            ) : (
              <p className="mt-1.5 text-[11px] leading-snug text-foreground-subtle">{p.none}</p>
            )}

            {error && <p className="mt-1.5 text-[11px] leading-snug text-danger">{error}</p>}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" /> {t.logOut}
          </button>
        </div>
      )}
    </div>
  );
}
