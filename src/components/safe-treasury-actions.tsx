"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Send, PiggyBank, Landmark } from "lucide-react";
import { proporEnvio, proporStake, proporUnstake, type Proposta, type TokenEnviavel } from "@/app/actions/treasury-safe";

/**
 * Enviar, stakear e desstakear a partir de um multisig, pela tela do tesouro.
 *
 * Os botões dizem "Propor" porque é isso que acontece: um Safe não executa por
 * clique. A transação entra na fila e as pessoas assinam no app.safe.global —
 * o da SOPA é 2 de 5. Um botão escrito "Enviar" mentiria em todo clique, e a
 * pessoa só descobriria ao ver que o dinheiro não saiu.
 *
 * Fechado por padrão: a maior parte das visitas ao tesouro é para olhar, e um
 * formulário de mover dinheiro aberto o tempo todo é um clique errado à espera.
 */

type Modo = "enviar" | "stake" | "unstake";

export function SafeTreasuryActions({
  safe,
  vaultKey,
  vaultAssetSymbol,
}: {
  safe: string;
  /** Cofre ligado a este multisig. Sem ele, só o envio aparece. */
  vaultKey?: string;
  vaultAssetSymbol?: string;
}) {
  const [modo, setModo] = useState<Modo | null>(null);
  const [token, setToken] = useState<TokenEnviavel>("USDC");
  const [para, setPara] = useState("");
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [res, setRes] = useState<Proposta | null>(null);

  const abas: { id: Modo; label: string; Icon: typeof Send }[] = [
    { id: "enviar", label: "Enviar", Icon: Send },
    ...(vaultKey
      ? ([
          { id: "stake" as const, label: "Stake", Icon: PiggyBank },
          { id: "unstake" as const, label: "Unstake", Icon: Landmark },
        ])
      : []),
  ];

  function trocar(id: Modo) {
    setModo((m) => (m === id ? null : id));
    setRes(null);
  }

  async function enviar() {
    if (ocupado || !modo) return;
    setOcupado(true);
    setRes(null);
    const r =
      modo === "enviar"
        ? await proporEnvio({ safe, token, para, valor })
        : modo === "stake"
          ? await proporStake({ safe, vaultKey: vaultKey!, valor })
          : await proporUnstake({ safe, vaultKey: vaultKey!, valor });
    setOcupado(false);
    setRes(r);
    if (r.ok) {
      setValor("");
      setPara("");
    }
  }

  const podeEnviar = valor.trim() !== "" && (modo !== "enviar" || para.trim() !== "");

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap gap-1.5">
        {abas.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => trocar(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              modo === id
                ? "border-accent-border bg-accent-bg text-accent"
                : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {modo && (
        <div className="mt-3 space-y-2">
          {modo === "enviar" && (
            <div className="flex flex-wrap gap-2">
              <select
                value={token}
                onChange={(e) => setToken(e.target.value as TokenEnviavel)}
                className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground"
                aria-label="Token"
              >
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
              </select>
              <input
                value={para}
                onChange={(e) => setPara(e.target.value)}
                placeholder="0x… destino"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-foreground-faint"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder={modo === "enviar" ? `quantia em ${token}` : `quantia em ${vaultAssetSymbol ?? "USDC"}`}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs tabular-nums text-foreground placeholder:text-foreground-faint"
            />
            <button
              type="button"
              onClick={enviar}
              disabled={ocupado || !podeEnviar}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition disabled:opacity-50"
            >
              {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Propor
            </button>
          </div>

          {/* O que o clique faz de verdade, dito antes do clique. */}
          <p className="text-[11px] text-foreground-faint">
            {modo === "unstake"
              ? "Puxa do adaptador e saca, na mesma transação — o cofre mantém zero ocioso, então um saque sozinho reverteria."
              : modo === "stake"
                ? "Aprova e deposita na mesma transação, para não sobrar aprovação pendurada sem depósito."
                : "Entra na fila do Safe; ninguém é debitado até as assinaturas."}
          </p>

          {res && !res.ok && <p className="text-xs text-danger">{res.error}</p>}
          {res?.ok && (
            <a
              href={res.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success"
            >
              Na fila — assinar no Safe <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
