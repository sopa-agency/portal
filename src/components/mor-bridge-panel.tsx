"use client";

// A ponte do MOR, no painel de capital: o que está parado na Arbitrum, as duas
// cotações lado a lado, e um "propor" por rota.
//
// Cotar é um clique separado de propor, de propósito. A cotação do swaps.pro
// demora alguns segundos e vale minutos; puxá-la no carregamento da página
// seria pagar essa espera toda vez que alguém abre o tesouro para olhar um
// número. Quem vai mover dinheiro clica, vê os dois preços e escolhe.
//
// O padrão da casa é o swaps.pro: os claims são semanais e por organização,
// US$ 2–3 por ponte, e nesse tamanho o custo proporcional ganha do fixo do
// OFT. A tela não esconde o OFT — ela marca qual das duas é a mais barata
// PARA ESTE valor, porque acima de uns US$ 12 a resposta inverte.

import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { quoteMorBridge, proposeMorBridge, refreshBridgeContext, type PonteCotacao, type PonteRota } from "@/app/actions/mor-bridge";
import { MorBridgeExecButton } from "@/components/mor-bridge-exec-button";
import type { BridgeContext } from "@/lib/mor-bridge";
import { useLocale } from "@/components/locale-provider";
import { ArbitrumDelegateButton } from "@/components/arbitrum-delegate-button";

const mor = (s: string) => Number(s).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const hhmm = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const minsLeft = (unix: number) => Math.floor((unix * 1000 - Date.now()) / 60_000);

/** Custo total em USD de uma rota: perda de câmbio (MOR) + ETH pago pelo Safe. */
function custoUsd(q: PonteRota, morUsd: number | null, ethUsd: number | null): number | null {
  if (morUsd == null || ethUsd == null) return null;
  return Number(q.lossMor) * morUsd + Number(q.costEth) * ethUsd;
}

export function MorBridgePanel({
  safe,
  initial,
  morUsd,
  ethUsd,
}: {
  safe: string;
  initial: BridgeContext;
  morUsd: number | null;
  ethUsd: number | null;
}) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.bridge;
  const [cotacao, setCotacao] = useState<PonteCotacao | null>(null);
  const [cotando, setCotando] = useState(false);
  const [propondo, setPropondo] = useState<"swapspro" | "oft" | null>(null);
  const [feito, setFeito] = useState<{ url: string; receives: string; provider: string; deadline?: number; replaced: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // O registro do delegate é um pré-requisito de propor, não de cotar. Vira
  // `true` na hora em que a assinatura é aceita, sem recarregar a página.
  const [delegateOk, setDelegateOk] = useState<boolean | null>(initial.delegateOk);
  // Execução direta (carteira de um dono, sem fila): o resultado e a chegada.
  const [executada, setExecutada] = useState<{ hash: string; receives: string; provider: string; via: "swapspro" | "oft" } | null>(null);
  const [morBase, setMorBase] = useState<string>(initial.morBase);
  const [conferindo, setConferindo] = useState(false);
  const direto = initial.threshold === 1 && initial.owners.length > 0;

  async function conferir() {
    setConferindo(true);
    try {
      const r = await refreshBridgeContext({ safe });
      if (r.ok) setMorBase(r.ctx.morBase);
    } finally {
      setConferindo(false);
    }
  }

  const temMor = initial.morArbWei !== "0" && initial.morArb !== "?";

  async function cotar() {
    setCotando(true);
    setErro(null);
    setFeito(null);
    try {
      const r = await quoteMorBridge({ safe });
      if (r.ok) setCotacao(r);
      else setErro(r.error);
    } catch {
      setErro("Falha ao cotar.");
    } finally {
      setCotando(false);
    }
  }

  async function propor(via: "swapspro" | "oft") {
    if (propondo) return;
    setPropondo(via);
    setErro(null);
    try {
      const r = await proposeMorBridge({ safe, via });
      if (r.ok) setFeito(r);
      else setErro(r.error);
    } catch {
      setErro("Falha ao propor a ponte.");
    } finally {
      setPropondo(null);
    }
  }

  const sp = cotacao?.swapspro.ok ? cotacao.swapspro.quote : null;
  const oft = cotacao?.oft.ok ? cotacao.oft.quote : null;
  const custoSp = sp ? custoUsd(sp, morUsd, ethUsd) : null;
  const custoOft = oft ? custoUsd(oft, morUsd, ethUsd) : null;
  const maisBarata: "swapspro" | "oft" | null =
    custoSp != null && custoOft != null ? (custoSp <= custoOft ? "swapspro" : "oft") : null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-faint">
            <ArrowRightLeft className="h-3.5 w-3.5" /> {t.title}
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {temMor ? t.waiting(mor(initial.morArb)) : t.none}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground-faint">{t.hint}</p>
          {direto && temMor && <p className="mt-1 text-[11px] text-foreground-muted">{t.execHint}</p>}
        </div>
        {temMor && !cotacao && (
          <button
            type="button"
            onClick={() => void cotar()}
            disabled={cotando}
            className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {cotando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {cotando ? t.quoting : t.quote}
          </button>
        )}
      </div>

      {cotacao && (
        <div className="grid gap-3 md:grid-cols-2">
          <Rota
            titulo={t.viaSwapsPro}
            quote={sp}
            erro={cotacao.swapspro.ok ? null : cotacao.swapspro.error}
            custo={custoSp}
            marcada={maisBarata === "swapspro"}
            piso
            onPropor={() => void propor("swapspro")}
            propondo={propondo === "swapspro"}
            bloqueado={propondo != null || feito != null || delegateOk === false || executada != null}
            direto={direto ? { safe, via: "swapspro", owners: initial.owners, onDone: setExecutada } : null}
          />
          <Rota
            titulo={t.viaOft}
            quote={oft}
            erro={cotacao.oft.ok ? null : cotacao.oft.error}
            custo={custoOft}
            marcada={maisBarata === "oft"}
            piso={false}
            onPropor={() => void propor("oft")}
            propondo={propondo === "oft"}
            bloqueado={propondo != null || feito != null || delegateOk === false || executada != null}
            direto={direto ? { safe, via: "oft", owners: initial.owners, onDone: setExecutada } : null}
          />
        </div>
      )}

      {cotacao && <p className="text-[11px] leading-relaxed text-foreground-faint">{t.firm}</p>}

      {/* Sem o delegate registrado na Arbitrum, "propor" volta com erro da API
          do Safe. A tela diz isso ANTES do clique e oferece o registro — uma
          assinatura de um dono, sem transação. */}
      {temMor && delegateOk !== true && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
          <p className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {delegateOk === false ? t.delegateMissing : t.delegateUnknown}
          </p>
          {initial.delegate && <ArbitrumDelegateButton safe={safe} delegate={initial.delegate} onDone={() => setDelegateOk(true)} />}
        </div>
      )}
      {temMor && delegateOk === true && <p className="text-[11px] text-success">✓ {t.delegateOk}</p>}

      {executada && (
        <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[11px] leading-relaxed text-success">
          <p className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {t.execDone} {t.receives(mor(executada.receives))} · {executada.provider} · {t.arrival}
          </p>
          <p className="flex flex-wrap items-center gap-3">
            <a
              href={executada.via === "oft" ? `https://layerzeroscan.com/tx/${executada.hash}` : `https://scan.li.fi/tx/${executada.hash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline"
            >
              {t.track} <ExternalLink className="h-3 w-3" />
            </a>
            <a href={`https://arbiscan.io/tx/${executada.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
              {t.onArbiscan} <ExternalLink className="h-3 w-3" />
            </a>
            <button type="button" onClick={() => void conferir()} disabled={conferindo} className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2 py-0.5 font-semibold disabled:opacity-50">
              {conferindo && <Loader2 className="h-3 w-3 animate-spin" />} {t.checkArrival}
            </button>
            <span className="tabular-nums">{t.onBase(morBase)}</span>
          </p>
        </div>
      )}

      {feito && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[11px] leading-relaxed text-success">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {t.queued} {t.receives(mor(feito.receives))} · {feito.provider}
          {feito.deadline ? <strong>{t.signNow(hhmm(feito.deadline))}</strong> : null}
          {feito.replaced ? <span>{t.replaced}</span> : null}
          <a href={feito.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
            {t.queueLink} <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      )}

      {erro && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {erro}
        </p>
      )}

      <p className={`text-[11px] ${initial.claimsLeft >= 0 && initial.claimsLeft < 3 ? "text-warning" : "text-foreground-faint"}`}>
        {t.eth(initial.ethArb, initial.ethMain, initial.claimsLeft < 0 ? "?" : String(initial.claimsLeft))}
        {initial.claimsLeft >= 0 && initial.claimsLeft < 3 ? ` — ${t.ethLow}` : ""}
      </p>
    </div>
  );
}

function Rota({
  titulo,
  quote,
  erro,
  custo,
  marcada,
  piso,
  onPropor,
  propondo,
  bloqueado,
  direto,
}: {
  titulo: string;
  quote: PonteRota | null;
  erro: string | null;
  custo: number | null;
  marcada: boolean;
  piso: boolean;
  onPropor: () => void;
  propondo: boolean;
  bloqueado: boolean;
  /** Safe 1-de-N na Arbitrum: oferece executar direto com a carteira do dono. */
  direto: { safe: string; via: "swapspro" | "oft"; owners: string[]; onDone: (r: { hash: string; receives: string; provider: string; via: "swapspro" | "oft" }) => void } | null;
}) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.bridge;
  return (
    <div className={`space-y-2 rounded-xl border p-3 ${marcada ? "border-accent-border bg-accent-bg" : "border-border bg-surface-elevated"}`}>
      <p className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-foreground">
        <span>{titulo}</span>
        {marcada && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">{t.cheaper}</span>}
      </p>
      {erro && <p className="text-[11px] text-warning">{t.failed(erro)}</p>}
      {quote && (
        <>
          <p className="text-sm font-semibold tabular-nums text-foreground">{t.receives(mor(quote.receives))}</p>
          <p className="text-[11px] text-foreground-faint">
            {piso ? t.floor(mor(quote.floor)) : t.exact}
            {quote.deadline ? ` · ${minsLeft(quote.deadline) > 0 ? t.validUntil(hhmm(quote.deadline), minsLeft(quote.deadline)) : t.expired}` : ""}
            {" · "}
            {t.cost(
              [
                Number(quote.lossMor) > 0 ? `${mor(quote.lossMor)} MOR` : null,
                Number(quote.costEth) > 0 ? `${Number(quote.costEth).toFixed(6)} ETH` : null,
                custo != null ? `≈ US$ ${custo.toFixed(2)}` : null,
              ]
                .filter(Boolean)
                .join(" + "),
            )}
          </p>
          <div className="flex flex-wrap items-start gap-2">
            {direto && !bloqueado && <MorBridgeExecButton safe={direto.safe} via={direto.via} owners={direto.owners} onDone={direto.onDone} />}
            <button
              type="button"
              onClick={onPropor}
              disabled={bloqueado}
              className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              {propondo && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {propondo ? t.proposing : t.propose}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
