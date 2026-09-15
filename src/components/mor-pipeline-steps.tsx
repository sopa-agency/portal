"use client";

// O ciclo do MOR de um Safe, numa linha: Claim (mainnet) → Ponte (Arbitrum)
// → Restake (Base). Cada passo mostra o que tem, o que falta, e UM botão só
// quando há o que fazer. As explicações moram nos "?", como nos números.
//
// Veio no lugar de três blocos empilhados com seis botões: a ponte com duas
// cotações abertas, o registro do delegate em amarelo, o claim solto no meio
// dos números. A pessoa olhava e não sabia por onde começar — e o ciclo tem
// uma ordem, então a tela tem a mesma.
//
// A ponte escolhe o LayerZero por padrão: é a própria token atravessando,
// sem agregador, sem prazo. O swaps.pro fica a um clique, com o preço ao
// lado, porque é o teste que o Vlad quer fazer — mas depois de um dia em que
// três propostas por ele venceram antes da assinatura e uma quarta levou o
// scanner do Safe a apontar um executor não verificado, o padrão não podia
// ser ele. Com a carteira de um dono conectada e threshold 1, a ponte executa
// direto; senão, propõe na fila.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { proposeCapitalClaim } from "@/app/actions/capital-claim";
import { quoteMorBridge, proposeMorBridge, refreshBridgeContext, type PonteRota } from "@/app/actions/mor-bridge";
import { MorStakeButton } from "@/components/mor-stake-button";
import type { BridgeContext } from "@/lib/mor-bridge";
import type { PoolKey } from "@/lib/morpheus-capital";
import { runBridgeExec, type ExecFase } from "@/components/mor-bridge-exec";
import { ArbitrumDelegateButton } from "@/components/arbitrum-delegate-button";
import { useWallet } from "@/components/wallet-provider";
import { useLocale } from "@/components/locale-provider";

export type ClaimStep = { pool: PoolKey; asset: string; pendingMor: number; open: boolean; opensAt: string | null };

const mor = (n: number | string) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const hhmm = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help rounded-full border border-border px-1 text-[9px] leading-none text-foreground-faint">
      ?
    </span>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[9px] text-foreground-subtle">{n}</span>
        {title}
        <Hint text={hint} />
      </p>
      {children}
    </div>
  );
}

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50";

export function MorPipelineSteps({
  safe,
  claims,
  ctx,
  morUsd,
  ethUsd,
  canRestake,
}: {
  safe: string;
  claims: ClaimStep[];
  ctx: BridgeContext;
  morUsd: number | null;
  ethUsd: number | null;
  /** Só a SOPA tem restake ligado hoje; a SkateHive espera a decisão do destino. */
  canRestake: boolean;
}) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.steps;
  const wallet = useWallet();

  const [morBase, setMorBase] = useState(ctx.morBase);
  const [delegateOk, setDelegateOk] = useState(ctx.delegateOk);

  const pendentes = claims.filter((c) => c.pendingMor > 0);
  // Resíduo de ponte (o OFT apara para 6 casas e sobra ~1e-6) não é "ponte a
  // fazer": abaixo de 0,001 MOR o passo diz que não há nada esperando.
  const temArb = ctx.morArb !== "?" && BigInt(ctx.morArbWei) >= BigInt("1000000000000000");
  const direto = ctx.threshold === 1 && ctx.owners.length > 0 && wallet.available;

  return (
    <div className="grid overflow-hidden rounded-2xl border border-border bg-surface md:grid-cols-3 md:divide-x divide-y md:divide-y-0 divide-border">
      {/* ── 1. claim ─────────────────────────────────────────── */}
      <Step n={1} title={t.claim} hint={t.claimHint}>
        {pendentes.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t.nothingToClaim}</p>
        ) : (
          pendentes.map((c) => <ClaimLine key={c.pool} safe={safe} c={c} morUsd={morUsd} />)
        )}
        <p className={`text-[11px] ${ctx.claimsLeft >= 0 && ctx.claimsLeft < 3 ? "text-warning" : "text-foreground-faint"}`}>
          {t.ethFor(ctx.ethMain, ctx.claimsLeft < 0 ? "?" : String(ctx.claimsLeft))}
        </p>
      </Step>

      {/* ── 2. ponte ─────────────────────────────────────────── */}
      <Step n={2} title={t.bridge} hint={t.bridgeHint}>
        {!temArb ? (
          <p className="text-sm text-foreground-muted">{t.nothingOnArbitrum}</p>
        ) : (
          <BridgeAction
            safe={safe}
            ctx={ctx}
            direto={direto}
            delegateOk={delegateOk}
            onDelegate={() => setDelegateOk(true)}
            morUsd={morUsd}
            ethUsd={ethUsd}
            onArrivalCheck={async () => {
              const r = await refreshBridgeContext({ safe });
              if (r.ok) setMorBase(r.ctx.morBase);
            }}
            morBase={morBase}
          />
        )}
      </Step>

      {/* ── 3. restake ───────────────────────────────────────── */}
      <Step n={3} title={t.restake} hint={t.restakeHint}>
        <p className="text-sm font-semibold tabular-nums text-foreground">{t.onBase(morBase === "?" ? "?" : mor(morBase))}</p>
        {canRestake ? <MorStakeButton safe={safe} compact /> : <p className="text-[11px] text-foreground-faint">{t.restakePending}</p>}
      </Step>
    </div>
  );
}

/* ── claim: uma linha por pool com MOR acumulado ─────────────────────────── */
function ClaimLine({ safe, c, morUsd }: { safe: string; c: ClaimStep; morUsd: number | null }) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.steps;
  const tc = dict.treasury.capital;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; mor: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await proposeCapitalClaim({ safe, pool: c.pool });
      if (r.ok) setDone({ url: r.url, mor: r.mor });
      else setErr(r.error);
    } catch {
      setErr(tc.claimAction);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold tabular-nums text-foreground">{mor(c.pendingMor)} MOR</span>
        <span className="text-[11px] text-foreground-faint">
          {c.asset}
          {morUsd != null ? ` · ≈ US$ ${(c.pendingMor * morUsd).toFixed(2)}` : ""}
          {!c.open && c.opensAt ? ` · ${t.unlocksAt(c.opensAt)}` : ""}
        </span>
      </p>
      {done ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="h-3 w-3" /> {t.queuedMainnet}
          <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
            {tc.claimQueueLink} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </p>
      ) : c.open ? (
        <button type="button" onClick={() => void run()} disabled={busy} className={btn}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {busy ? tc.claimMeasuring : t.claimAction}
        </button>
      ) : null}
      {err && <p className="text-[11px] text-warning">{err}</p>}
    </div>
  );
}

/* ── ponte: LayerZero por padrão, swaps.pro ao lado; executa ou propõe ────── */
function BridgeAction({
  safe,
  ctx,
  direto,
  delegateOk,
  onDelegate,
  morUsd,
  ethUsd,
  onArrivalCheck,
  morBase,
}: {
  safe: string;
  ctx: BridgeContext;
  direto: boolean;
  delegateOk: boolean | null;
  onDelegate: () => void;
  morUsd: number | null;
  ethUsd: number | null;
  onArrivalCheck: () => Promise<void>;
  morBase: string;
}) {
  const { t: dict } = useLocale();
  const t = dict.treasury.capital.steps;
  const tb = dict.treasury.capital.bridge;
  const wallet = useWallet();
  const [fase, setFase] = useState<"idle" | "quoting" | "quoted" | ExecFase | "proposing" | "done">("idle");
  const [rotas, setRotas] = useState<{ oft: PonteRota | null; sp: PonteRota | null; erroSp?: string; erroOft?: string } | null>(null);
  const [via, setVia] = useState<"oft" | "swapspro">("oft");
  const [feito, setFeito] = useState<{ kind: "exec" | "proposed"; hash?: string; url?: string; receives: string; mined?: boolean | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [checando, setChecando] = useState(false);
  // "Agora" capturado na hora de cotar — render tem de ser puro.
  const [cotadoEm, setCotadoEm] = useState(0);

  const custo = (q: PonteRota | null) => (q && morUsd != null && ethUsd != null ? Number(q.lossMor) * morUsd + Number(q.costEth) * ethUsd : null);

  async function cotar() {
    setFase("quoting");
    setErro(null);
    try {
      const r = await quoteMorBridge({ safe });
      setCotadoEm(Date.now());
      if (!r.ok) throw new Error(r.error);
      setRotas({ oft: r.oft.ok ? r.oft.quote : null, sp: r.swapspro.ok ? r.swapspro.quote : null, erroOft: r.oft.ok ? undefined : r.oft.error, erroSp: r.swapspro.ok ? undefined : r.swapspro.error });
      setVia(r.oft.ok ? "oft" : "swapspro");
      setFase("quoted");
    } catch (e) {
      setFase("idle");
      setErro((e as Error).message?.slice(0, 200) ?? "");
    }
  }

  async function agir() {
    setErro(null);
    try {
      if (direto) {
        const r = await runBridgeExec({
          safe,
          via,
          owners: ctx.owners,
          wallet,
          onFase: setFase,
          msgs: { noWallet: tb.execNoWallet, notOwner: tb.execNotOwner, wrongChain: t.wrongChain },
        });
        setFeito({ kind: "exec", hash: r.hash, receives: r.receives, mined: r.mined });
      } else {
        setFase("proposing");
        const r = await proposeMorBridge({ safe, via });
        if (!r.ok) throw new Error(r.error);
        setFeito({ kind: "proposed", url: r.url, receives: r.receives });
      }
      setFase("done");
    } catch (e) {
      setFase("quoted");
      const code = (e as { code?: number }).code;
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "";
      setErro(code === 4001 || /reject|denied/i.test(msg) ? t.cancelled : msg.slice(0, 220));
    }
  }

  const escolhida = rotas ? (via === "oft" ? rotas.oft : rotas.sp) : null;
  const outra = rotas ? (via === "oft" ? rotas.sp : rotas.oft) : null;
  const outraVia = via === "oft" ? "swapspro" : "oft";
  const busy = fase !== "idle" && fase !== "quoted" && fase !== "done";
  const rotulo =
    fase === "quoting" ? tb.quoting : fase === "connecting" ? tb.execConnecting : fase === "building" ? tb.execBuilding : fase === "signing" ? tb.execSigning : fase === "mining" ? tb.execMining : fase === "proposing" ? tb.proposing : direto ? t.run : tb.propose;

  if (feito) {
    const link = feito.kind === "exec" ? (via === "oft" ? `https://layerzeroscan.com/tx/${feito.hash}` : `https://scan.li.fi/tx/${feito.hash}`) : feito.url;
    return (
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="h-3 w-3" />
          {feito.kind === "exec" ? (feito.mined === false ? tb.execFailed : tb.execDone) : tb.queued} {tb.receives(mor(feito.receives))}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
              {feito.kind === "exec" ? tb.track : tb.queueLink} <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-foreground-faint">
          <span>{t.onBase(morBase === "?" ? "?" : mor(morBase))}</span>
          <button
            type="button"
            onClick={() => {
              setChecando(true);
              void onArrivalCheck().finally(() => setChecando(false));
            }}
            disabled={checando}
            className="inline-flex items-center gap-1 underline disabled:opacity-50"
          >
            {checando && <Loader2 className="h-3 w-3 animate-spin" />} {tb.checkArrival}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold tabular-nums text-foreground">{t.onArbitrum(mor(ctx.morArb))}</p>

      {escolhida && (
        <p className="text-[11px] leading-relaxed text-foreground-faint">
          <span className="text-foreground-muted">{via === "oft" ? t.viaLz : t.viaSp}</span> · {tb.receives(mor(escolhida.receives))}
          {custo(escolhida) != null ? ` · US$ ${custo(escolhida)!.toFixed(2)}` : ""}
          {escolhida.deadline ? ` · ${tb.validUntil(hhmm(escolhida.deadline), Math.max(0, Math.floor((escolhida.deadline * 1000 - cotadoEm) / 60_000)))}` : ""}
          {outra && (
            <>
              {" · "}
              <button type="button" onClick={() => setVia(outraVia)} className="underline hover:text-accent">
                {t.useOther(outraVia === "oft" ? t.viaLz : t.viaSp, mor(outra.receives), custo(outra) != null ? `US$ ${custo(outra)!.toFixed(2)}` : "")}
              </button>
            </>
          )}
        </p>
      )}
      {rotas && !rotas.sp && rotas.erroSp && <p className="text-[11px] text-foreground-faint">{t.spUnavailable}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {fase === "idle" || fase === "quoting" ? (
          <button type="button" onClick={() => void cotar()} disabled={busy} className={btn}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {fase === "quoting" ? tb.quoting : t.bring}
          </button>
        ) : (
          <button type="button" onClick={() => void agir()} disabled={busy || !escolhida || (!direto && delegateOk === false)} className={btnPrimary}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {rotulo}
          </button>
        )}
        {fase === "quoted" && !direto && (
          <span className="text-[11px] text-foreground-faint">{t.willPropose}</span>
        )}
      </div>

      {/* Sem carteira de dono, a ponte vai pela fila — e a fila da Arbitrum só
          aceita o proposer registrado lá. Aparece só nesse caso. */}
      {fase === "quoted" && !direto && delegateOk !== true && ctx.delegate && (
        <div className="space-y-1 text-[11px] text-warning">
          <p>{delegateOk === false ? tb.delegateMissing : tb.delegateUnknown}</p>
          <ArbitrumDelegateButton safe={safe} delegate={ctx.delegate} onDone={onDelegate} />
        </div>
      )}

      {erro && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {erro}
        </p>
      )}
    </div>
  );
}

