"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { Wallet, Activity, PiggyBank } from "lucide-react";
import { formatRunwayMonths, monthsTone } from "@/lib/format";
import { useT } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { isOk, type Reading } from "@/lib/reading";

// The 3-card treasury cockpit hero — "quanto temos · está saudável? · quanto tempo
// dura". Shared by the SOPA dashboard (SopaTreasury) and the brand portals
// (BrandTreasury) so the health bands, copy and layout can't drift between them
// (they used to be two near-identical copies with two different runway bands).

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Verdict copy per reconciled band (monthsTone: <3 danger · <12 warning · else ok).
function health(runwayMonths: number | null, v: Dictionary["treasury"]["hero"]["verdicts"], unknown = false) {
  // An incomplete total can't be judged. Saying "Healthy" over a number we
  // couldn't finish reading is the same lie one level up.
  if (unknown) return { ...v.unknown, cls: "bg-foreground/10 text-foreground-muted" };
  if (runwayMonths == null) return { ...v.noCosts, cls: "bg-success/15 text-success" };
  const tone = monthsTone(runwayMonths);
  if (tone === "warning") return { ...v.warning, cls: "bg-warning/15 text-warning" };
  if (tone === "danger") return { ...v.danger, cls: "bg-danger/15 text-danger" };
  return { ...v.ok, cls: "bg-success/15 text-success" };
}

export function TreasuryHealthHero({
  label,
  total,
  walletCount,
  runwayMonths,
  runwayFooter,
  watermarkLogo,
  unreadLabels = [],
  unvalued = [],
  sourceCount,
}: {
  label: string;
  /**
   * The treasury figure as a READING. It used to be a number that was always
   * there and sometimes wrong: a wallet whose read failed contributed zero and
   * the total kept claiming completeness. On the page someone opens to decide a
   * payment, that number doesn't misinform — it decides.
   */
  total: Reading<number>;
  walletCount: number;
  runwayMonths: number | null;
  /** Caption under the runway number — each surface phrases it its own way. */
  runwayFooter: ReactNode;
  /** Optional project mark, watermarked in the total card's corner. */
  watermarkLogo?: string;
  /** Which sources didn't answer. Names make "incomplete" actionable. */
  unreadLabels?: string[];
  /**
   * O que está em carteira e não pôde ser precificado.
   *
   * Vale ao lado do número, não no lugar dele: aqui o saldo é conhecido e o
   * PREÇO não, então o total é um piso correto — diferente de uma fonte que não
   * respondeu, onde nem o saldo se sabe. Um deles retira o número; o outro
   * anota o que falta nele.
   */
  unvalued?: { symbol: string; balance: number }[];
  /** How many sources were attempted, for the "N of M" note. */
  sourceCount?: number;
}) {
  const t = useT().treasury.hero;
  const complete = isOk(total);
  // Runway is treasury ÷ burn. An incomplete treasury makes it incomplete too,
  // so it isn't shown rather than shown wrong.
  const shownRunway = complete ? runwayMonths : null;
  const h = health(shownRunway, t.verdicts, !complete);
  return (
    <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent-bg to-transparent p-5">
        {watermarkLogo && (
          <Image
            src={watermarkLogo}
            alt=""
            aria-hidden
            width={96}
            height={96}
            className="pointer-events-none absolute -right-3 -top-2 h-24 w-24 opacity-15"
          />
        )}
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
          <Wallet className="h-3.5 w-3.5" /> {t.treasury} · {label}
        </div>
        {complete ? (
          <div className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight text-foreground">{usd(total.value)}</div>
        ) : total.state === "insufficient" ? (
          // Terceiro estado, e ele NÃO é aviso: "não há fonte configurada" é
          // uma resposta correta, não uma falha. Pintar de amarelo mandaria
          // alguém investigar um problema que não existe — que é o erro que a
          // gente já cometeu ao contrário, tratando falha como número.
          <div className="mt-1.5 text-xl font-semibold tracking-tight text-foreground-muted">{t.noTreasury}</div>
        ) : (
          // Deliberadamente NÃO é um número, e deliberadamente não do tamanho de
          // um: uma soma parcial no lugar do total é a mentira, só que mais
          // baixinho.
          <div className="mt-1.5 text-xl font-bold uppercase tracking-tight text-warning">{t.incomplete}</div>
        )}
        <p className="mt-1 text-xs text-foreground-faint">
          {walletCount > 0 ? t.wallets(walletCount) : t.noWallets}
        </p>
        {!complete && unreadLabels.length > 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-warning">
            {t.incompleteNote(unreadLabels.length, sourceCount ?? walletCount, unreadLabels.join(", "))}
          </p>
        )}
        {unvalued.length > 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-foreground-subtle">
            {t.unvalued(unvalued.map((u) => `${u.symbol} (${u.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })})`).join(", "))}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground-faint">
          <Activity className="h-3.5 w-3.5" /> {t.health}
        </div>
        <div className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${h.cls}`}>{h.label}</div>
        <p className="mt-1.5 text-xs text-foreground-muted">{h.phrase}</p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground-faint"
          title={t.runwayTitle}
        >
          <PiggyBank className="h-3.5 w-3.5" /> {t.runway}
        </div>
        <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
          {formatRunwayMonths(shownRunway)}
          {shownRunway != null && <span className="ml-1 text-sm font-medium text-foreground-faint">{t.months}</span>}
        </div>
        <p className="mt-1 text-xs text-foreground-faint">{runwayFooter}</p>
      </div>
    </section>
  );
}
