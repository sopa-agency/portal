"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { Wallet, Activity, PiggyBank } from "lucide-react";
import { formatRunwayMonths, monthsTone } from "@/lib/format";
import { useT } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";

// The 3-card treasury cockpit hero — "quanto temos · está saudável? · quanto tempo
// dura". Shared by the SOPA dashboard (SopaTreasury) and the brand portals
// (BrandTreasury) so the health bands, copy and layout can't drift between them
// (they used to be two near-identical copies with two different runway bands).

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Verdict copy per reconciled band (monthsTone: <3 danger · <12 warning · else ok).
function health(runwayMonths: number | null, v: Dictionary["treasury"]["hero"]["verdicts"]) {
  if (runwayMonths == null) return { ...v.noCosts, cls: "bg-success/15 text-success" };
  const tone = monthsTone(runwayMonths);
  if (tone === "warning") return { ...v.warning, cls: "bg-warning/15 text-warning" };
  if (tone === "danger") return { ...v.danger, cls: "bg-danger/15 text-danger" };
  return { ...v.ok, cls: "bg-success/15 text-success" };
}

export function TreasuryHealthHero({
  label,
  totalUsd,
  walletCount,
  runwayMonths,
  runwayFooter,
  watermarkLogo,
}: {
  label: string;
  totalUsd: number;
  walletCount: number;
  runwayMonths: number | null;
  /** Caption under the runway number — each surface phrases it its own way. */
  runwayFooter: ReactNode;
  /** Optional project mark, watermarked in the total card's corner. */
  watermarkLogo?: string;
}) {
  const t = useT().treasury.hero;
  const h = health(runwayMonths, t.verdicts);
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
        <div className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight text-foreground">{usd(totalUsd)}</div>
        <p className="mt-1 text-xs text-foreground-faint">
          {walletCount > 0 ? t.wallets(walletCount) : t.noWallets}
        </p>
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
          {formatRunwayMonths(runwayMonths)}
          {runwayMonths != null && <span className="ml-1 text-sm font-medium text-foreground-faint">{t.months}</span>}
        </div>
        <p className="mt-1 text-xs text-foreground-faint">{runwayFooter}</p>
      </div>
    </section>
  );
}
