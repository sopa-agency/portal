"use client";

// A lista de carteiras que podem ENTRAR no portal.
//
// Não é a mesma coisa que o contato "Wallet" da ficha de cada pessoa — e a
// diferença é o ponto inteiro deste painel. Aquele campo é dado operacional,
// editável por qualquer membro; este é credencial, e credencial que qualquer um
// edita não é credencial. A primeira leva veio de lá, uma vez, sob auditoria;
// daqui em diante entra à mão.
//
// Adicionar e liberar são DOIS gestos. Uma carteira nova nasce bloqueada e só
// entra depois de alguém clicar "liberar". Um clique distraído numa lista de
// endereços parecidos não pode virar acesso.

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { addWalletLogin, listWalletLoginsAction, removeWalletLogin, setWalletLoginEnabled } from "@/app/actions/team-admin";

type Row = {
  address: string;
  username: string;
  enabled: boolean;
  source: string;
  addedBy: string;
  lastLoginAt: string | null;
};

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function WalletLoginAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [novoUser, setNovoUser] = useState("");
  const [novoAddr, setNovoAddr] = useState("");

  const carregar = () =>
    listWalletLoginsAction().then((r) => {
      if (r.ok) setRows(r.rows);
      // Falha de leitura NÃO vira lista vazia: uma lista vazia aqui diz
      // "ninguém entra por carteira", que é uma afirmação e tanto.
      else setErr(r.error);
    });

  useEffect(() => {
    void carregar();
  }, []);

  async function adicionar() {
    setBusy("add");
    setErr(null);
    const r = await addWalletLogin(novoUser, novoAddr);
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setNovoUser("");
    setNovoAddr("");
    await carregar();
  }

  async function alternar(addr: string, enabled: boolean) {
    setBusy(addr);
    setErr(null);
    const r = await setWalletLoginEnabled(addr, enabled);
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    await carregar();
  }

  async function remover(addr: string) {
    setBusy(addr);
    setErr(null);
    const r = await removeWalletLogin(addr);
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    await carregar();
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <KeyRound className="h-4 w-4 text-accent" /> Entrar com carteira
      </h2>
      <p className="mt-1.5 max-w-2xl text-xs text-foreground-subtle">
        Quem está aqui e <strong>liberado</strong> pode entrar no portal assinando com a carteira. Esta lista é
        separada do contato “Wallet” da ficha de cada pessoa de propósito: aquele campo qualquer membro edita, e
        credencial que qualquer um edita não é credencial. Carteira nova nasce bloqueada — adicionar e liberar são
        dois gestos.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={novoUser}
          onChange={(e) => setNovoUser(e.target.value)}
          placeholder="usuário"
          className="w-36 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
        />
        <input
          value={novoAddr}
          onChange={(e) => setNovoAddr(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
        />
        <button
          type="button"
          onClick={adicionar}
          disabled={busy === "add" || !novoUser.trim() || !novoAddr.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
        >
          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Adicionar bloqueada
        </button>
      </div>

      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}

      <ul className="mt-4 space-y-1.5">
        {rows === null ? (
          <li className="text-xs text-foreground-faint">carregando…</li>
        ) : rows.length === 0 ? (
          <li className="text-xs text-foreground-faint">nenhuma carteira cadastrada</li>
        ) : (
          rows.map((r) => (
            <li
              key={r.address}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs"
            >
              <span className="shrink-0 font-medium text-foreground">@{r.username}</span>
              <span className="shrink-0 font-mono text-foreground-muted" title={r.address}>
                {short(r.address)}
              </span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  r.enabled ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                }`}
              >
                {r.enabled ? "liberada" : "bloqueada"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-foreground-faint">
                {r.source === "seed" ? "da leva inicial" : `por @${r.addedBy}`}
                {r.lastLoginAt ? ` · entrou ${new Date(r.lastLoginAt).toLocaleDateString("pt-BR")}` : " · nunca entrou"}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => alternar(r.address, !r.enabled)}
                  disabled={busy === r.address}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40"
                >
                  {busy === r.address ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : r.enabled ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <LockOpen className="h-3 w-3" />
                  )}
                  {r.enabled ? "bloquear" : "liberar"}
                </button>
                <button
                  type="button"
                  onClick={() => remover(r.address)}
                  disabled={busy === r.address}
                  aria-label="remover"
                  className="rounded-md p-1 text-foreground-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
