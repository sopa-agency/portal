"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Layers, Wallet } from "lucide-react";
import type { TreasuryGroup, EvmWalletReport, HiveAccountReport } from "@/lib/treasury";
import { TokenLogo } from "@/components/token-logo";
import { useT } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { isOk, sumReadings } from "@/lib/reading";

const usd = (n: number, max = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 1 ? 4 : max });
const num = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Asset allocation palette — distinct hues tuned to read on BOTH light and dark
// surfaces (per the theme rules, chart colors live outside the token system).
const PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899",
  "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48",
];
const REST_COLOR = "#94a3b8"; // slate-400 — the "Outros" bucket
const colorAt = (i: number) => PALETTE[i % PALETTE.length];

// ---------------------------------------------------------------------------
// Aggregation — collapse every wallet/account into a unified holdings list so
// the reader gets the portfolio at a glance, Zerion-style.
// ---------------------------------------------------------------------------

// `usdUnknown` = this asset has a balance whose USD we can't price (rule 5). Its
// quantity is real; the USD column shows "indisponível", and it never inflates
// the USD total with a made-up price.
type Asset = {
  symbol: string;
  /** Logo do indexador. Decoração, NUNCA credencial — um token de phishing
   *  também traz logo bonito, então a marca de não-verificado continua ao lado. */
  icon?: string | null;
  chains: string[];
  /** Quebra por rede, para a linha abrir sem uma segunda leitura. Padrão que a
   *  gente pegou do portfolio do swaps.pro: uma linha por ATIVO, expansível —
   *  em vez de uma linha por (ativo × rede), que multiplica a lista. */
  parts: { chain: string; balance: number; valueUsd: number | null }[];
  /** Posição de PROTOCOLO (staking, LP, lending) — dinheiro que rende mas não
   *  está solto. Vive numa seção separada: misturar com token à vista faz duas
   *  liquidezes diferentes lerem igual. */
  protocol?: string | null;
  balance: number;
  valueUsd: number;
  usdUnknown: boolean;
  /** Indexer-supplied label — see lib/token-label.ts. Never rendered as a link. */
  untrusted?: boolean;
  hostileLabel?: boolean;
};

function aggregateAssets(groups: TreasuryGroup[]): Asset[] {
  const map = new Map<string, Asset>();
  const add = (
    symbol: string,
    chain: string,
    balance: number,
    valueUsd: number | null,
    untrusted = false,
    hostileLabel = false,
    icon: string | null = null,
    protocol: string | null = null,
  ) => {
    // The key carries `untrusted`, and that is load-bearing: anyone can deploy a
    // token whose symbol is "USDC". Keying on the symbol alone would add the
    // impostor's balance to the real USDC row and inflate the total. An
    // untrusted token never shares a row with a trusted one.
    const k = `${untrusted ? "u:" : "t:"}${protocol ? `p:${protocol}:` : ""}${symbol.toUpperCase()}`;
    // A chave separa protocolo de token solto: "MOR" e "MOR em stake" são
    // linhas distintas de propósito.
    const a = map.get(k) ?? { symbol, chains: [], parts: [], balance: 0, valueUsd: 0, usdUnknown: false, untrusted, hostileLabel, icon, protocol };
    if (!a.icon && icon) a.icon = icon;
    a.parts.push({ chain, balance, valueUsd });
    a.balance += balance;
    if (valueUsd == null) a.usdUnknown = true;
    else a.valueUsd += valueUsd;
    if (hostileLabel) a.hostileLabel = true;
    if (!a.chains.includes(chain)) a.chains.push(chain);
    map.set(k, a);
  };
  for (const g of groups) {
    const prices = g.report.prices;
    for (const w of g.report.evm) for (const t of w.tokens) add(t.symbol, t.chain, t.balance, t.valueUsd, t.untrusted, t.hostileLabel, t.icon ?? null, t.note ?? null);
    for (const h of g.report.hive) {
      add("HIVE", "Hive", h.hive + h.hp, (h.hive + h.hp) * prices.hive);
      add("HBD", "Hive", h.hbd + h.hbdSavings, (h.hbd + h.hbdSavings) * prices.hbd);
    }
  }
  // Keep priced assets over $0.50, AND any unpriced asset with a real balance.
  return [...map.values()]
    .filter((a) => a.valueUsd > 0.5 || (a.usdUnknown && a.balance > 0))
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

/**
 * Marks a row whose name came from the chain, not from us.
 *
 * `hostile` is the loud version, for labels that read like an advert ("View
 * Airdrops at …"). The point is the opposite of decoration: this portal wears a
 * client's brand, so anything shown inside it looks endorsed by SOPA unless we
 * say otherwise, in words, next to the thing.
 */
function UnverifiedTag({ hostile }: { hostile?: boolean }) {
  return hostile ? (
    <span
      className="rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger"
      title="Nome escrito por quem criou o token, não pela SOPA. Não é um link e não deve ser seguido."
    >
      ⚠ não confie no nome
    </span>
  ) : (
    <span
      className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint"
      title="Token encontrado na carteira pelo indexador. Nome e símbolo vêm do próprio contrato — a SOPA não verificou."
    >
      não verificado
    </span>
  );
}

type Segment = { label: string; valueUsd: number; color: string };

/** Top-N segments + an aggregated "rest" tail, for a stacked allocation bar. */
function toSegments(items: { label: string; valueUsd: number }[], restLabel: string, topN = 6): Segment[] {
  const sorted = [...items].sort((a, b) => b.valueUsd - a.valueUsd).filter((i) => i.valueUsd > 0);
  const head = sorted.slice(0, topN).map((i, idx) => ({ ...i, color: colorAt(idx) }));
  const tail = sorted.slice(topN);
  if (tail.length) head.push({ label: restLabel, valueUsd: tail.reduce((s, i) => s + i.valueUsd, 0), color: REST_COLOR });
  return head;
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function Monogram({ symbol, color }: { symbol: string; color: string }) {
  return <TokenLogo symbol={symbol} color={color} size={28} />;
}

/**
 * O logo do token: a imagem quando existe, o monograma quando não.
 *
 * A imagem vem de terceiro e continua valendo como ENFEITE, nunca como prova de
 * legitimidade — token de phishing também traz logo bonito. Quem decide como a
 * linha é exibida segue sendo `untrusted`/`hostileLabel`, e a etiqueta de aviso
 * fica ao lado do nome, não do desenho.
 *
 * Se a imagem não carregar, o monograma reaparece no lugar dela: a linha nunca
 * fica com um buraco onde deveria haver identidade.
 */
function TokenAvatar({ symbol, color, icon }: { symbol: string; color: string; icon?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!icon || broken) return <Monogram symbol={symbol} color={color} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={icon}
      alt=""
      aria-hidden
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded-full"
      onError={() => setBroken(true)}
    />
  );
}

function AllocationBar({ segments, total }: { segments: Segment[]; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-border">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${Math.max((s.valueUsd / total) * 100, 0.6)}%`, backgroundColor: s.color }}
            title={`${s.label} · ${usd(s.valueUsd)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="font-medium text-foreground">{s.label}</span>
            <span className="tabular-nums text-foreground-faint">{pct((s.valueUsd / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** The hero + composition + holdings overview for the current view. */
function Overview({ groups, title, hideTotal = false }: { groups: TreasuryGroup[]; title: string; hideTotal?: boolean }) {
  const t = useT().treasury.views;
  // Same wording as the hero's incomplete plate — one phrasing for one meaning.
  const th = useT().treasury.hero;
  const grand = sumReadings(groups.map((g) => g.report.total));
  const evmTotal = sumReadings(groups.map((g) => g.report.evmTotal));
  const hiveTotal = sumReadings(groups.map((g) => g.report.hiveTotal));
  const unreadLabels = groups.flatMap((g) => g.report.unreadLabels);
  const assets = useMemo(() => aggregateAssets(groups), [groups]);
  const [dustOpen, setDustOpen] = useState(false);
  /**
   * Denominator for the shares and the bars: what is actually LISTED below,
   * not the treasury total.
   *
   * These percentages describe the composition of the holdings on screen, and
   * that set is honest by construction — every asset in it read. Dividing by a
   * claimed treasury total would make the slices depend on a number that may be
   * incomplete, and they'd silently stop adding to 100%.
   */
  const listedUsd = useMemo(() => assets.reduce((sum, a) => sum + a.valueUsd, 0), [assets]);
  // Linhas abertas. Uma linha por ATIVO; a quebra por rede vive dentro dela, e
  // só existe para quem clica — a lista fica curta por padrão.
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = (k: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const walletCount = groups.reduce((s, g) => s + g.report.evm.length + g.report.hive.length, 0);
  const chainCount = new Set(assets.flatMap((a) => a.chains)).size;

  const assetColor = useMemo(() => {
    const m = new Map<string, string>();
    assets.slice(0, 6).forEach((a, i) => m.set(a.symbol.toUpperCase(), colorAt(i)));
    return (sym: string) => m.get(sym.toUpperCase()) ?? REST_COLOR;
  }, [assets]);

  const assetSegments = useMemo(
    () => toSegments(assets.map((a) => ({ label: a.symbol, valueUsd: a.valueUsd })), t.others),
    [assets, t.others],
  );
  const projectSegments = useMemo(
    () =>
      toSegments(
        // A group that couldn't be read is left OUT rather than drawn as a
        // sliver of zero — the bar shows the composition of what answered.
        groups.filter((g) => isOk(g.report.total)).map((g) => ({ label: g.name, valueUsd: (g.report.total as { value: number }).value })),
        t.others,
      ),
    [groups, t.others],
  );
  const multi = groups.length > 1;

  // Live Hive yields (first treasury that carries them). HP APR is an estimate
  // (inflation→vesting); HBD savings APR is authoritative (chain rate).
  const hiveApr = groups.find((g) => g.report.hiveApr)?.report.hiveApr ?? null;
  const aprFor = (symbol: string): { text: string; est: boolean } | null => {
    if (!hiveApr) return null;
    const s = symbol.toUpperCase();
    if (s === "HIVE" && hiveApr.hp > 0) return { text: `HP ~${hiveApr.hp.toFixed(1)}% APR`, est: true };
    if (s === "HBD" && hiveApr.hbdSavings > 0) return { text: `savings ${hiveApr.hbdSavings.toFixed(0)}% APR`, est: false };
    return null;
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
      {/* Hero */}
      <div className={`border-b border-border p-5 ${hideTotal ? "" : "bg-gradient-to-br from-accent-bg to-transparent"}`}>
        {!hideTotal && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{title}</p>
            {isOk(grand) ? (
              <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums text-foreground">{usd(grand.value)}</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold uppercase tracking-tight text-warning">{th.incomplete}</p>
                {unreadLabels.length > 0 && (
                  <p className="mt-1 text-[11px] leading-snug text-warning">
                    {th.incompleteNote(unreadLabels.length, walletCount, unreadLabels.join(", "))}
                  </p>
                )}
              </>
            )}
          </>
        )}
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${hideTotal ? "" : "mt-4"}`}>
          <Stat label="EVM" value={isOk(evmTotal) ? usd(evmTotal.value) : th.incomplete} />
          <Stat label="Hive" value={isOk(hiveTotal) ? usd(hiveTotal.value) : th.incomplete} />
          <Stat label={t.assets} value={String(assets.length)} />
          <Stat label={multi ? t.wallets : t.networks} value={String(multi ? walletCount : chainCount)} />
        </div>
      </div>

      {/* Composition */}
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        {multi && (
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              <Layers className="h-3.5 w-3.5" /> {t.byProject}
            </h4>
            <AllocationBar segments={projectSegments} total={listedUsd} />
          </div>
        )}
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            <Wallet className="h-3.5 w-3.5" /> {t.byAsset}
          </h4>
          <AllocationBar segments={assetSegments} total={listedUsd} />
        </div>
      </div>

      {/* Holdings — à vista primeiro, rendendo depois.
          Separado de propósito: token solto e posição de protocolo têm
          liquidez diferente e não podem ler como a mesma linha. Padrão vindo do
          portfolio do swaps.pro, que usa abas para a mesma distinção. */}
      {(() => {
        // POEIRA ATRÁS DE UM BOTÃO.
        //
        // O multisig da SkateHive tem 27 tokens: fora US$ 63 de USDC, o resto é
        // airdrop sem liquidez. Listar tudo com o mesmo peso faz a lista mentir
        // sobre onde o dinheiro está — que é exatamente o que este bloco se
        // propõe a responder.
        //
        // O corte é em US$ 5 e a poeira NÃO some: fica atrás de "ver mais",
        // contada e somada no rótulo do botão. Esconder sem dizer quanto foi
        // escondido seria trocar uma lista ruim por um número incompleto.
        const DUST = 5;
        // SEM PREÇO TAMBÉM É POEIRA, e isto é uma correção de rumo.
        //
        // Eu tinha deixado o sem-preço de fora do corte com um argumento que
        // soa bem — "ele não vale menos de 5, ele não tem preço". Só que na
        // tela o efeito era o oposto do que a lista existe para fazer: NOGS,
        // WZRD, cbXRP, Buster, skatehive, DeepSeek desfilando com o mesmo peso
        // do dinheiro de verdade, todos com "USD n/d". Sem preço confiável, o
        // token não ajuda a responder onde o dinheiro está.
        //
        // Continua sem sumir: entra na mesma gaveta, e o botão diz quantos são.
        const semPreco = (a: Asset) => a.usdUnknown;
        const ehPoeira = (a: Asset) => !a.protocol && (semPreco(a) || a.valueUsd < DUST);
        const poeira = assets.filter(ehPoeira);
        const liquid = assets.filter((a) => !a.protocol && !ehPoeira(a));
        const earning = assets.filter((a) => a.protocol);
        const poeiraUsd = poeira.reduce((sum, a) => sum + a.valueUsd, 0);
        const renderRow = (a: Asset) => {
            const share = listedUsd > 0 ? (a.valueUsd / listedUsd) * 100 : 0;
            const color = assetColor(a.symbol);
            return (
              <li key={`${a.protocol ?? ""}:${a.symbol}`} className="px-6 py-3">
                <div
                  className={`flex items-center gap-3 ${a.parts.length > 1 ? "cursor-pointer" : ""}`}
                  onClick={a.parts.length > 1 ? () => toggleRow(`${a.protocol ?? ""}:${a.symbol}`) : undefined}
                  role={a.parts.length > 1 ? "button" : undefined}
                  tabIndex={a.parts.length > 1 ? 0 : undefined}
                  onKeyDown={
                    a.parts.length > 1
                      ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(`${a.protocol ?? ""}:${a.symbol}`); } }
                      : undefined
                  }
                >
                {/*
                  UM logo por linha. Havia dois: o monograma (o círculo com a
                  letra, de quando não existia imagem) e o ícone que a Zerion
                  passou a trazer. O segundo entrou e ninguém tirou o primeiro.
                  Agora o ícone real OCUPA o lugar do monograma, e o monograma
                  volta a ser o que sempre foi — o que se mostra quando não há
                  imagem.
                */}
                <TokenAvatar symbol={a.symbol} color={color} icon={a.icon} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Plain text, always. A token label is never an <a>, never
                        a title-linkified string — see lib/token-label.ts. */}
                    <span className="text-sm font-semibold text-foreground">{a.symbol}</span>
                    {a.untrusted && <UnverifiedTag hostile={a.hostileLabel} />}
                    {a.chains.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint"
                      >
                        {c}
                      </span>
                    ))}
                    {(() => {
                      const apr = aprFor(a.symbol);
                      return apr ? (
                        <span
                          className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success"
                          title={apr.est ? t.aprEstimate : t.aprSavings}
                        >
                          {apr.text}{apr.est ? "*" : ""}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <p className="mt-0.5 text-[11px] tabular-nums text-foreground-faint">{num(a.balance, 4)} {a.symbol}</p>
                </div>
                <div className="w-28 shrink-0">
                  <div className="h-1.5 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(share, 1.5)}%`, backgroundColor: color }} />
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  {a.usdUnknown && a.valueUsd < 0.5 ? (
                    <p className="text-xs font-medium tabular-nums text-foreground-faint" title="sem fonte de preço confiável">
                      USD n/d
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold tabular-nums text-foreground">{usd(a.valueUsd)}</p>
                      <p className="text-[11px] tabular-nums text-foreground-faint">{pct(share)}</p>
                    </>
                  )}
                </div>
                </div>
                {a.parts.length > 1 && openRows.has(`${a.protocol ?? ""}:${a.symbol}`) && (
                  <ul className="ml-10 mt-2 space-y-1 border-l border-border pl-3">
                    {[...a.parts]
                      .sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0))
                      .map((pt, i) => (
                        <li key={`${pt.chain}-${i}`} className="flex items-center gap-2 text-[11px]">
                          <span className="uppercase tracking-wider text-foreground-faint">{pt.chain}</span>
                          <span className="tabular-nums text-foreground-muted">{num(pt.balance, 4)}</span>
                          <span className="ml-auto tabular-nums text-foreground-subtle">
                            {pt.valueUsd == null ? "USD n/d" : usd(pt.valueUsd)}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            );
          };
        return (
          <>
            {/*
              RENDENDO VEM PRIMEIRO. Antes o spot abria a lista e o que está em
              stake ficava no rodapé — e é o contrário do que a lista responde:
              dinheiro trabalhando é a posição sobre a qual alguém decide, e
              dinheiro parado é o troco. No multisig da SkateHive, os US$ 1.916
              de stETH na MorpheusAI apareciam DEPOIS de US$ 63 de USDC solto.
            */}
            {earning.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-border bg-surface-elevated px-6 py-2">
                  <Layers className="h-3.5 w-3.5 text-foreground-faint" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                    rendendo — sai com unstake
                  </span>
                </div>
                <ul className="divide-y divide-border">{earning.map(renderRow)}</ul>
              </>
            )}
            {liquid.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-border bg-surface-elevated px-6 py-2">
                  <Wallet className="h-3.5 w-3.5 text-foreground-faint" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                    parado — disponível agora
                  </span>
                </div>
                <ul className="divide-y divide-border">{liquid.map(renderRow)}</ul>
              </>
            )}
            {poeira.length > 0 && (
              <>
                {dustOpen && (
                  <ul className="divide-y divide-border border-t border-border">{poeira.map(renderRow)}</ul>
                )}
                <button
                  type="button"
                  onClick={() => setDustOpen((v) => !v)}
                  className="w-full border-t border-border px-6 py-2.5 text-left text-[11px] font-medium text-foreground-subtle transition-colors hover:bg-surface-elevated hover:text-foreground"
                >
                  {dustOpen
                    ? "esconder os menores"
                    : `ver mais ${poeira.length} — abaixo de US$ 5 ou sem preço${
                        poeiraUsd > 0 ? ` (os precificados somam ${usd(poeiraUsd)})` : ""
                      }`}
                </button>
              </>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-wallet detail (kept for drill-down, collapsed by default)
// ---------------------------------------------------------------------------

function EvmCard({ w, t }: { w: EvmWalletReport; t: Dictionary["treasury"]["views"] }) {
  const segs =
    w.totalUsd > 0
      ? toSegments(w.tokens.map((tk) => ({ label: `${tk.symbol}·${tk.chain}`, valueUsd: tk.valueUsd ?? 0 })), t.others)
      : [];
  return (
    <div className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{w.label}</p>
          <a
            href={`https://debank.com/profile/${w.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-foreground-subtle transition-colors hover:text-accent"
            title={w.address}
          >
            {shortAddr(w.address)}
            <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </a>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-foreground">
            {usd(w.totalUsd)}
            {w.failedChains.length > 0 && <span className="ml-1 text-xs font-medium text-warning">parcial</span>}
          </p>
          {w.tokens.length > 0 && (
            <p className="text-[10px] tabular-nums text-foreground-faint">{t.assetCount(w.tokens.length)}</p>
          )}
        </div>
      </div>
      {segs.length > 0 && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-border">
          {segs.map((s) => (
            <div key={s.label} className="h-full" style={{ width: `${Math.max((s.valueUsd / w.totalUsd) * 100, 0.6)}%`, backgroundColor: s.color }} />
          ))}
        </div>
      )}
      {w.failedChains.length > 0 && (
        // Rule 5: a failed read is a FAILURE, never a 0. Show it, keep the total
        // flagged "parcial", and still render whatever DID load.
        <p className="mt-3 text-xs text-warning">
          ⚠ {t.loadFailed} {w.failedChains.join(", ")} — desconhecido, não zero
        </p>
      )}
      {w.tokens.length > 0 ? (
        <div className="mt-4 space-y-2">
          {w.tokens.map((tk, i) => (
            <div key={`${tk.symbol}-${tk.chain}-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <TokenLogo symbol={tk.symbol} color={colorAt(i)} size={20} />
                {/* Text node only — no anchor, no linkify, no innerHTML. */}
                <span className="min-w-0 truncate font-medium text-foreground">{tk.symbol}</span>
                {tk.untrusted && <UnverifiedTag hostile={tk.hostileLabel} />}
                {tk.name && tk.name !== tk.symbol && (
                  <span className="min-w-0 truncate text-[11px] text-foreground-faint">{tk.name}</span>
                )}
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint">
                  {tk.chain}
                </span>
                {tk.note && (
                  <span className="text-[10px] text-foreground-faint" title={tk.note}>
                    ⓘ
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="text-foreground-faint">{num(tk.balance, 4)}</span>
                <span className="w-24 text-right font-medium text-foreground">
                  {tk.valueUsd == null ? <span className="text-foreground-faint">USD n/d</span> : usd(tk.valueUsd)}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : w.failedChains.length === 0 ? (
        <p className="mt-3 text-xs text-foreground-faint">{t.noBalances}</p>
      ) : null}
    </div>
  );
}

function HiveCard({ a, t }: { a: HiveAccountReport; t: Dictionary["treasury"]["views"] }) {
  return (
    <div className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://images.hive.blog/u/${a.account}/avatar`}
            alt={a.account}
            className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{a.label}</p>
            <a
              href={`https://skatehive.app/@${a.account}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-foreground-subtle transition-colors hover:text-accent"
            >
              @{a.account}
              <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </div>
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums text-foreground">{usd(a.usd)}</p>
      </div>
      {a.error ? (
        <p className="mt-3 text-xs text-danger">{t.loadFailed} {a.error}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["HIVE", a.hive],
              ["HP", a.hp],
              ["HBD", a.hbd],
              ["HBD Savings", a.hbdSavings],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-elevated px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{num(value)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WalletDetail({ groups, withHeadings, t }: { groups: TreasuryGroup[]; withHeadings: boolean; t: Dictionary["treasury"]["views"] }) {
  const th = useT().treasury.hero;
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <div key={g.slug} className="space-y-4">
          {withHeadings && (
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{g.name}</h3>
              <span
                className={`text-sm font-semibold tabular-nums ${isOk(g.report.total) ? "text-foreground-muted" : "text-warning"}`}
              >
                {isOk(g.report.total) ? usd(g.report.total.value) : th.incomplete}
              </span>
            </div>
          )}
          {g.report.evm.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {g.report.evm.map((w) => (
                <EvmCard key={w.address} w={w} t={t} />
              ))}
            </div>
          )}
          {g.report.hive.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {g.report.hive.map((a) => (
                <HiveCard key={a.account} a={a} t={t} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Treasury dashboard. A Zerion-style overview (hero total + composition +
 * holdings) sits up top for a fast read; per-wallet detail is tucked into a
 * collapsible section below. Multiple groups (admin overview) add a tab bar and
 * a "by project" allocation.
 */
export function TreasuryViews({ groups, hideSelector = false, hideTotal = false }: { groups: TreasuryGroup[]; hideSelector?: boolean; hideTotal?: boolean }) {
  const tr = useT().treasury;
  const t = tr.views;
  const [view, setView] = useState<string>("all");
  const [showDetail, setShowDetail] = useState(false);
  const multi = groups.length > 1;
  // When a parent owns the project filter (SOPA dashboard), it passes already
  // filtered `groups` and hides this local selector — so balances and revenue
  // switch together instead of drifting apart.
  const effectiveView = hideSelector ? "all" : view;
  const visible = effectiveView === "all" ? groups : groups.filter((g) => g.slug === effectiveView);
  const prices = groups[0]?.report.prices;
  const title =
    effectiveView === "all" ? (multi ? t.combined : visible[0]?.name ?? t.fallback) : visible[0]?.name ?? t.fallback;

  return (
    <div className="space-y-6">
      {multi && !hideSelector && (
        <div className="flex flex-wrap gap-1.5">
          {[{ slug: "all", name: tr.all }, ...groups].map((g) => (
            <button
              key={g.slug}
              type="button"
              onClick={() => setView(g.slug)}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                view === g.slug
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <Overview groups={visible} title={title} hideTotal={hideTotal} />

      <div>
        <button
          type="button"
          onClick={() => setShowDetail((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-subtle transition-colors hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetail ? "rotate-180" : ""}`} />
          {t.walletDetail}
        </button>
        {showDetail && (
          <div className="mt-4">
            <WalletDetail groups={visible} withHeadings={multi && view === "all"} t={t} />
          </div>
        )}
      </div>

      {prices && (
        <p className="text-[11px] text-foreground-faint">
          {t.pricesNote(usd(prices.hive, 2), usd(prices.hbd, 2))}{" "}
          <span className="text-foreground-faint">{t.aprFootnote}</span>
        </p>
      )}
    </div>
  );
}
