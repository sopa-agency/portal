"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, Wallet } from "lucide-react";

/**
 * "Minhas carteiras" — a pessoa adiciona a segunda sem depender de um admin.
 *
 * A prova é a MESMA do login: pedir o desafio, assinar, mandar. Reusar o
 * caminho em vez de inventar outro é o ponto — um segundo jeito de provar
 * posse de chave é um segundo jeito de errar.
 */
type Carteira = { address: string; enabled: boolean; lastLoginAt: string | null; source: string };
type Estado = { kind: "lendo" } | { kind: "pronto" } | { kind: "assinando"; msg: string } | { kind: "erro"; msg: string };

const curto = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function MyWallets() {
  const [carteiras, setCarteiras] = useState<Carteira[] | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>({ kind: "lendo" });

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/me/wallet");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "não deu para ler");
      setCarteiras(j.wallets as Carteira[]);
      setErroLeitura(null);
    } catch (e) {
      // Falha de leitura NÃO vira "você não tem carteira nenhuma": a segunda
      // afirmação apagaria da tela uma porta que existe.
      setErroLeitura(e instanceof Error ? e.message : "não deu para ler");
    } finally {
      setEstado({ kind: "pronto" });
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function adicionar() {
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error("Nenhuma carteira encontrada neste navegador.");
      setEstado({ kind: "assinando", msg: "Escolha a conta na carteira…" });
      const contas = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = contas?.[0]?.toLowerCase();
      if (!address) throw new Error("A carteira não devolveu nenhuma conta.");

      setEstado({ kind: "assinando", msg: "Pedindo o desafio…" });
      const rc = await fetch("/api/auth/challenge", { method: "POST" });
      const jc = await rc.json();
      if (!rc.ok || typeof jc.nonce !== "string") throw new Error(jc.error || "Falha no desafio.");

      setEstado({ kind: "assinando", msg: "Assine para provar que a carteira é sua…" });
      const signature = (await eth.request({ method: "personal_sign", params: [jc.nonce, address] })) as string;

      setEstado({ kind: "assinando", msg: "Conferindo…" });
      const r = await fetch("/api/me/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu para adicionar.");
      await carregar();
      setEstado({ kind: "pronto" });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setEstado({ kind: "erro", msg: /user rejected|denied/i.test(m) ? "Assinatura cancelada na carteira." : m });
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
        <Wallet className="h-4 w-4 text-accent" /> Minhas carteiras
      </h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground-subtle">
        Toda carteira aqui entra no portal e é reconhecida como sua na votação do split e no mérito. Adicione
        quantas quiser — a prova é a mesma do login: você assina, e a assinatura mostra que a chave é sua.
      </p>

      {erroLeitura ? (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          ⚠ Não deu para ler suas carteiras ({erroLeitura}). Isto NÃO quer dizer que você não tem nenhuma.
        </p>
      ) : carteiras && carteiras.length > 0 ? (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {carteiras.map((c) => (
            <li key={c.address} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-elevated px-3 py-2">
              <span className="flex-1 font-mono text-xs text-foreground">{curto(c.address)}</span>
              {c.enabled ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-success">
                  <Check className="h-3 w-3" /> entra
                </span>
              ) : (
                <span className="text-[11px] text-warning">cadastrada, ainda não liberada</span>
              )}
              <span className="text-[10px] text-foreground-faint">
                {c.lastLoginAt ? `último acesso ${new Date(c.lastLoginAt).toLocaleDateString("pt-BR")}` : "nunca usada para entrar"}
              </span>
            </li>
          ))}
        </ul>
      ) : carteiras ? (
        <p className="mt-3 text-xs text-foreground-faint">Nenhuma carteira cadastrada ainda.</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void adicionar()}
          disabled={estado.kind === "assinando" || estado.kind === "lendo"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
        >
          {estado.kind === "assinando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Adicionar outra carteira
        </button>
        {estado.kind === "assinando" && <span className="text-[11px] text-foreground-muted">{estado.msg}</span>}
        {estado.kind === "erro" && <span className="text-[11px] text-warning">⚠ {estado.msg}</span>}
      </div>
    </section>
  );
}
