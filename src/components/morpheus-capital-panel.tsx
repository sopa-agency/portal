import { ExternalLink, Landmark } from "lucide-react";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { realizedApy, type CapitalPosition } from "@/lib/morpheus-capital";
import { isOk, unread, type Reading } from "@/lib/reading";
import { rich } from "@/components/rich-text";
import { usd, pct } from "@/lib/format";

// A posição da SOPA na capital da Morpheus, como painel.
//
// É um Server Component ASSÍNCRONO de propósito: ele recebe PROMESSAS e é
// quem faz o await. Assim o <Suspense> do pai suspende de verdade — se o await
// fosse no JSX da página, a página inteira esperaria a mainnet responder (a
// lição do diagrama do split, que custou 19s neste mesmo arquivo).
//
// O preço do MOR vem separado da posição porque falha separado: a posição pode
// ler e o preço não, e nesse caso a quantidade de MOR aparece e só o valor em
// dólar (e o rendimento, que depende dele) ficam marcados como não lidos.

const morFmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

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
  position,
  morPrice,
}: {
  position: Promise<Reading<CapitalPosition>>;
  /** USD por MOR; null quando o feed de preço não respondeu. */
  morPrice: Promise<number | null>;
}) {
  const [pos, price, dict, locale] = await Promise.all([position, morPrice, getDictionary(), getLocale()]);
  const t = dict.treasury.capital;

  if (!isOk(pos)) {
    return (
      <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
        ⚠ {pos.state === "unread" ? t.unread(pos.reason) : t.unread(pos.note)}
      </p>
    );
  }
  const p = pos.value;
  if (p.deposited <= 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-xs leading-relaxed text-foreground-faint">
        {t.empty}
      </div>
    );
  }

  // Server Component em rota force-dynamic: roda uma vez por requisição, no
  // servidor, e "agora" é exatamente o que "quantos dias até o claim" precisa.
  // (Mesma justificativa do `dadoVelho` na página.)
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const apy: Reading<number> = price == null ? unread<number>(t.priceUnread) : realizedApy(p, price);
  const dateFmt = (d: Date) => d.toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "2-digit", year: "numeric" });
  const share = p.poolTotal > 0 ? pct((p.deposited / p.poolTotal) * 100) : null;
  const lockDays = p.claimLockEnd ? Math.ceil((p.claimLockEnd.getTime() - now) / 86_400_000) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={t.deposited}
          value={usd(p.deposited)}
          sub={[p.stakedAt ? t.since(dateFmt(p.stakedAt)) : null, share ? t.poolShare(share) : null].filter(Boolean).join(" · ")}
        />
        <Stat
          label={t.accrued}
          hint={t.accruedHint}
          value={`${morFmt(p.pendingMor)} MOR`}
          sub={price != null ? `≈ ${usd(p.pendingMor * price)}` : "USD n/d"}
          tone="text-success"
        />
        <Stat
          label={t.multiplier}
          value={`${p.multiplier.toFixed(3)}×`}
          sub={p.multiplier < 1.05 ? t.noLock : t.withLock}
        />
        {/* Três estados, três formatos. `insufficient` não é falha nem zero: a
            leitura passou, a janela é que é curta demais para anualizar. */}
        {isOk(apy) ? (
          <Stat label={t.realizedApy} hint={t.realizedApyHint} value={pct(apy.value * 100)} sub={locale === "pt" ? "ao ano · medido" : "per year · measured"} tone="text-success" />
        ) : apy.state === "insufficient" ? (
          <Stat label={t.realizedApy} hint={t.realizedApyHint} value="—" sub={apy.note} tone="text-foreground-muted" dashed />
        ) : (
          <Stat label={t.realizedApy} hint={t.realizedApyHint} value="—" sub={apy.reason} tone="text-warning" dashed />
        )}
        {p.claimLockEnd == null ? (
          <Stat label={t.claimAt} value="—" tone="text-foreground-muted" dashed />
        ) : lockDays != null && lockDays <= 0 ? (
          <Stat label={t.claimAt} hint={t.claimOpenHint} value={t.claimOpen} tone="text-success" />
        ) : (
          <Stat label={t.claimAt} value={dateFmt(p.claimLockEnd)} sub={t.inDays(lockDays ?? 0)} tone="text-warning" />
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-accent-border bg-accent-bg px-4 py-3 text-xs leading-relaxed text-foreground-muted">
        <span className="flex-1 min-w-[16rem]">{rich(t.receiverNote)}</span>
        <a
          href={`https://etherscan.io/address/${p.pool}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-accent hover:underline"
        >
          <Landmark className="h-3 w-3" /> {p.pool.slice(0, 6)}…{p.pool.slice(-4)} <ExternalLink className="h-3 w-3" />
        </a>
      </div>
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
