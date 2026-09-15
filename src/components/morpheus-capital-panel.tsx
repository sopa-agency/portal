import { ExternalLink, Landmark } from "lucide-react";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { realizedApy, type CapitalPosition } from "@/lib/morpheus-capital";
import { MorPipelineSteps, type ClaimStep } from "@/components/mor-pipeline-steps";
import { readBridgeContext } from "@/lib/mor-bridge";
import { isOk, unread, type Reading } from "@/lib/reading";
import { usd, pct } from "@/lib/format";

// A posição de UM Safe na capital da Morpheus: os números por pool, e embaixo
// o ciclo em três passos (claim → ponte → restake) com as ações.
//
// Números em cima, ações embaixo, numa linha só. Antes as ações vinham
// espalhadas — claim no meio dos números, ponte num bloco, delegate noutro —
// e a tela virou uma lista de botões. Ver `MorPipelineSteps`.
//
// É um Server Component ASSÍNCRONO de propósito: ele recebe PROMESSAS e é
// quem faz o await. Assim o <Suspense> do pai suspende de verdade — se o await
// fosse no JSX da página, a página inteira esperaria a mainnet responder.
//
// Os preços vêm separados da posição porque falham separado: a posição pode
// ler e o preço não, e nesse caso a quantidade aparece e só o valor em dólar
// (e o rendimento, que depende dele) ficam marcados como não lidos. O stETH
// precisa do preço do ETH até para dizer quanto está depositado em dólar.

const morFmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Stat({ label, value, sub, hint, tone = "text-foreground", dashed = false }: { label: string; value: string; sub?: string; hint?: string; tone?: string; dashed?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-surface p-4 ${dashed ? "border-dashed border-border-strong" : "border-border"}`}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
        {label}
        {hint && (
          <span title={hint} className="cursor-help rounded-full border border-border px-1 text-[9px] leading-none">?</span>
        )}
      </div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-foreground-faint">{sub}</div>}
    </div>
  );
}

export async function MorpheusCapitalPanel({
  owner,
  positions,
  morPrice,
  ethPrice,
  canPropose,
}: {
  /** O Safe dono da posição — o receiver do claim, sempre. */
  owner: { label: string; address: string };
  /** Uma leitura por pool, na ordem de `MORPHEUS_POOLS`. */
  positions: Promise<Reading<CapitalPosition>[]>;
  /** USD por MOR; null quando o feed de preço não respondeu. */
  morPrice: Promise<number | null>;
  /** USD por ETH — o stETH vale isso; null quando o feed não respondeu. */
  ethPrice: Promise<number | null>;
  /** Sessão válida: só então o ciclo de ações aparece. */
  canPropose: boolean;
}) {
  // O contexto do ciclo (MOR na Arbitrum e na Base, ETH, Safe da Arbitrum)
  // lê em paralelo com as posições: é a mesma espera, não uma a mais.
  const [lidas, price, ethUsd, dict, locale, ciclo] = await Promise.all([
    positions, morPrice, ethPrice, getDictionary(), getLocale(), canPropose ? readBridgeContext(owner.address) : null,
  ]);
  const t = dict.treasury.capital;

  const falhas = [...new Set(lidas.filter((r) => !isOk(r)).map((r) => (r.state === "unread" ? r.reason : r.note)))];
  const comDeposito = lidas.filter(isOk).map((r) => r.value).filter((p) => p.deposited > 0);

  // Server Component em rota force-dynamic: roda uma vez por requisição, no
  // servidor, e "agora" é exatamente o que "quantos dias até o claim" precisa.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const dateFmt = (d: Date) => d.toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "2-digit", year: "numeric" });

  const claims: ClaimStep[] = comDeposito.map((p) => {
    const opensAt = p.claimOpensAt ?? p.claimLockEnd;
    return { pool: p.poolKey, asset: p.asset, pendingMor: p.pendingMor, open: opensAt != null && opensAt.getTime() <= now, opensAt: opensAt ? dateFmt(opensAt) : null };
  });

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-semibold text-foreground-muted">{owner.label}</span>
        <span className="font-mono text-foreground-faint">{shortAddr(owner.address)}</span>
      </p>

      {falhas.map((reason) => (
        <p key={reason} className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          ⚠ {t.unread(owner.label, reason)}
        </p>
      ))}

      {comDeposito.length === 0 && falhas.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-xs leading-relaxed text-foreground-faint">
          {t.empty}
        </div>
      )}

      {comDeposito.map((p) => {
        // USDC vale um dólar por definição do pool; stETH vale o que o ETH vale.
        const assetUsd = p.poolKey === "usdc" ? 1 : ethUsd;
        const depositedUsd = assetUsd != null ? p.deposited * assetUsd : null;
        const apy: Reading<number> =
          price == null || assetUsd == null ? unread<number>(t.priceUnread) : realizedApy(p, price, assetUsd);
        const share = p.poolTotal > 0 ? pct((p.deposited / p.poolTotal) * 100) : null;
        // `claimOpensAt` já é a MAIOR das duas travas (protocolo e usuário).
        const opensAt = p.claimOpensAt ?? p.claimLockEnd;
        const lockDays = opensAt ? Math.ceil((opensAt.getTime() - now) / 86_400_000) : null;
        const claimAberto = opensAt != null && opensAt.getTime() <= now;

        return (
          <div key={p.poolKey} className="space-y-2">
            <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-faint">
              <span>{t.poolLabel(p.asset)}</span>
              <a
                href={`https://etherscan.io/address/${p.pool}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono normal-case tracking-normal text-accent hover:underline"
              >
                <Landmark className="h-3 w-3" /> {shortAddr(p.pool)} <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat
                label={t.deposited}
                value={p.poolKey === "usdc" ? usd(p.deposited) : `${p.deposited.toFixed(4)} ${p.asset}`}
                sub={[
                  p.poolKey !== "usdc" ? (depositedUsd != null ? `≈ ${usd(depositedUsd)}` : "USD n/d") : null,
                  p.stakedAt ? t.since(dateFmt(p.stakedAt)) : null,
                  share ? t.poolShare(share) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Stat
                label={t.accrued}
                hint={t.accruedHint}
                value={`${morFmt(p.pendingMor)} MOR`}
                sub={price != null ? `≈ ${usd(p.pendingMor * price)}` : "USD n/d"}
                tone="text-success"
              />
              <Stat label={t.multiplier} value={`${p.multiplier.toFixed(3)}×`} sub={p.multiplier < 1.05 ? t.noLock : t.withLock} />
              {isOk(apy) ? (
                <Stat label={t.realizedApy} hint={t.realizedApyHint} value={pct(apy.value * 100)} sub={locale === "pt" ? "ao ano · medido" : "per year · measured"} tone="text-success" />
              ) : apy.state === "insufficient" ? (
                <Stat label={t.realizedApy} hint={t.realizedApyHint} value="—" sub={apy.note} tone="text-foreground-muted" dashed />
              ) : (
                <Stat label={t.realizedApy} hint={t.realizedApyHint} value="—" sub={apy.reason} tone="text-warning" dashed />
              )}
              {opensAt == null ? (
                <Stat label={t.claimAt} value="—" tone="text-foreground-muted" dashed />
              ) : claimAberto ? (
                <Stat label={t.claimAt} hint={t.claimOpenHint} value={t.claimOpen} tone="text-success" />
              ) : (
                <Stat label={t.claimAt} value={dateFmt(opensAt)} sub={t.inDays(lockDays ?? 0)} tone="text-warning" />
              )}
            </div>
          </div>
        );
      })}

      {/* O ciclo, com as ações. Só com sessão: cotar é barato, mas propor e
          executar mexem em dinheiro. */}
      {ciclo && comDeposito.length > 0 && (
        <MorPipelineSteps
          safe={owner.address}
          claims={claims}
          ctx={ciclo}
          morUsd={price}
          ethUsd={ethUsd}
          // O destino e o mesmo para os dois Safes: o subnet da Gnars (decisao
          // do Vlad em 14/09/2026). A acao confere que o Safe e da Base.
          canRestake
        />
      )}
    </div>
  );
}

/** O esqueleto que o Suspense mostra enquanto a mainnet responde. */
export function MorpheusCapitalSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl border border-border bg-surface-elevated" />
        ))}
      </div>
      <p className="text-[11px] text-foreground-faint">{label}</p>
    </div>
  );
}
