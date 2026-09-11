"use client";

import { useMemo, useState, type ReactNode } from "react";
import { SafeTreasuryActions } from "@/components/safe-treasury-actions";
import { safeAppUrl, zerionWalletUrl } from "@/lib/wallet-links";
import { ChevronDown, ExternalLink } from "lucide-react";
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
  parts: {
    chain: string;
    balance: number;
    valueUsd: number | null;
    /** De qual carteira veio esta fatia. A tabela agrega por ATIVO, entao sem
     *  isto a linha sabe quanto existe e nao de onde sai — e nao da para
     *  oferecer "enviar" sem saber de qual Safe. */
    wallet?: { label: string; address: string; safeChainId?: number };
  }[];
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
    wallet?: { label: string; address: string; safeChainId?: number },
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
    a.parts.push({ chain, balance, valueUsd, wallet });
    a.balance += balance;
    if (valueUsd == null) a.usdUnknown = true;
    else a.valueUsd += valueUsd;
    if (hostileLabel) a.hostileLabel = true;
    if (!a.chains.includes(chain)) a.chains.push(chain);
    map.set(k, a);
  };
  for (const g of groups) {
    const prices = g.report.prices;
    for (const w of g.report.evm)
      for (const t of w.tokens)
        add(t.symbol, t.chain, t.balance, t.valueUsd, t.untrusted, t.hostileLabel, t.icon ?? null, t.note ?? null, {
          label: w.label,
          address: w.address,
          safeChainId: w.safeChainId,
        });
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
  const t = useT().treasury.views;
  return hostile ? (
    <span
      className="rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger"
      title={t.untrustedNameTitle}
    >
      ⚠ {t.untrustedName}
    </span>
  ) : (
    <span
      className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint"
      title={t.unverifiedTitle}
    >
      {t.unverified}
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

/**
 * O que a gente sabe mover a partir de um Safe.
 *
 * Casa com o que `treasury-safe.ts` aceita, e o servidor resolve o endereco —
 * o navegador manda so o simbolo. Outro token entra aqui e la juntos.
 */
function acionavel(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s === "USDC" || s === "ETH";
}

/** Os Safes que seguram este ativo, sem repetir carteira. */
function safesDoAtivo(a: Asset): { label: string; address: string; safeChainId?: number }[] {
  const vistos = new Set<string>();
  const out: { label: string; address: string; safeChainId?: number }[] = [];
  for (const p of a.parts) {
    const w = p.wallet;
    if (!w?.safeChainId) continue;
    const k = w.address.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(w);
  }
  return out;
}

/**
 * Cor de cada rede, como identidade — não como tema. É o que diferencia um
 * USDC na Base de um USDC na Ethereum quando a linha é a mesma. Tons que leem
 * nos dois fundos; rede desconhecida cai num cinza que também lê.
 */
const CHAIN_COLORS: Record<string, string> = {
  base: "#2151F5",
  ethereum: "#8A92B2",
  zora: "#E86A4A",
  hive: "#E31337",
  gnosis: "#3E6957",
  arbitrum: "#28A0F0",
  optimism: "#FF0420",
  polygon: "#8247E5",
};
const chainColor = (c: string) => CHAIN_COLORS[c.toLowerCase()] ?? "#8C8C96";

/**
 * A regra de poeira, UMA só — para a lista de ativos e para o detalhe por
 * carteira: abaixo de US$ 5 ou sem preço, fora do que está em protocolo
 * (posição rende; não é poeira).
 *
 * Eram duas regras: US$ 5 na lista, US$ 0,01 no detalhe — e a segunda ainda
 * mantinha os sem preço. Abrir o multisig da SkateHive (27 tokens, quase tudo
 * airdrop) mostrava um muro de linhas sem valor logo abaixo de uma lista que
 * já as tinha escondido. Duas regras para a mesma pergunta era só uma questão
 * de tempo até divergirem — e divergiram.
 */
const DUST_USD = 5;
const isDust = (valueUsd: number | null, inProtocol: boolean) =>
  !inProtocol && (valueUsd == null || valueUsd < DUST_USD);

function ChainDots({ chains }: { chains: string[] }) {
  return (
    <span className="inline-flex items-center gap-1" title={chains.join(" · ")}>
      {chains.map((c) => (
        <span key={c} className="h-2 w-2 rounded-full" style={{ backgroundColor: chainColor(c) }} aria-label={c} />
      ))}
    </span>
  );
}

function ChainLegend({ chains }: { chains: string[] }) {
  if (!chains.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5">
      {chains.map((c) => (
        <span key={c} className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-foreground-faint">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chainColor(c) }} />
          {c}
        </span>
      ))}
    </div>
  );
}

/** Parado vs rendendo, na proporção do dólar: "quanto disto eu movo hoje?" numa barra. */
function SplitBar({ liquidUsd, earningUsd }: { liquidUsd: number; earningUsd: number }) {
  const total = liquidUsd + earningUsd;
  if (total <= 0) return null;
  const idle = (liquidUsd / total) * 100;
  return (
    <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-elevated" title={`${pct(idle)} · ${pct(100 - idle)}`}>
      <div className="bg-success" style={{ width: `${idle}%` }} />
      <div className="bg-accent" style={{ width: `${100 - idle}%` }} />
    </div>
  );
}

function Overview({
  groups,
  title,
  hideTotal = false,
  canPropose = false,
  vault,
  monthlyBurnUsd = 0,
  chart,
}: {
  groups: TreasuryGroup[];
  title: string;
  /** O gráfico do escopo, já filtrado por quem sabe qual é o escopo. */
  chart?: ReactNode;
  hideTotal?: boolean;
  canPropose?: boolean;
  vault?: { key: string; assetSymbol: string; chainId: number };
  /** Custo fixo mensal do escopo — vira saúde e runway. Zero = não há custo
   *  lançado aqui, que é diferente de custo desconhecido. */
  monthlyBurnUsd?: number;
}) {
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
  const multi = groups.length > 1;

  // "Quem tem o quê": por projeto quando há vários; por carteira quando é um só.
  // Um grupo que não leu fica DE FORA em vez de virar uma fatia de zero — a
  // barra mostra a composição do que respondeu.
  const holders = useMemo(() => {
    if (multi)
      return groups
        .filter((g) => isOk(g.report.total))
        .map((g) => ({ label: g.name, valueUsd: (g.report.total as { value: number }).value }));
    const g = groups[0];
    if (!g) return [];
    return [
      ...g.report.evm.map((w) => ({ label: w.label, valueUsd: w.totalUsd })),
      ...g.report.hive.map((a) => ({ label: a.label, valueUsd: a.usd })),
    ].sort((x, y) => y.valueUsd - x.valueUsd);
  }, [groups, multi]);
  const holdersTotal = holders.reduce((sum, h) => sum + h.valueUsd, 0) || 1;
  const chainsPresent = useMemo(() => [...new Set(assets.flatMap((a) => a.chains))], [assets]);

  // POEIRA ATRÁS DE UM BOTÃO.
  //
  // O multisig da SkateHive tem 27 tokens: fora US$ 63 de USDC, o resto é
  // airdrop sem liquidez. Listar tudo com o mesmo peso faz a lista mentir
  // sobre onde o dinheiro está. O corte é em US$ 5 e a poeira NÃO some: fica
  // atrás de "ver poeira", contada e somada. SEM PREÇO TAMBÉM É POEIRA — sem
  // preço confiável o token não ajuda a responder onde o dinheiro está.
  //
  // Vive aqui, fora da lista, porque a barra parado/rendendo no cabeçalho do
  // card precisa dos mesmos totais que a lista usa — uma conta, dois lugares.
  const split = useMemo(() => {
    const ehPoeira = (a: Asset) => isDust(a.usdUnknown ? null : a.valueUsd, !!a.protocol);
    const poeira = assets.filter(ehPoeira);
    const liquid = assets.filter((a) => !a.protocol && !ehPoeira(a));
    const earning = assets.filter((a) => a.protocol);
    const soma = (l: Asset[]) => l.reduce((sum, a) => sum + a.valueUsd, 0);
    return { poeira, liquid, earning, poeiraUsd: soma(poeira), liquidUsd: soma(liquid), earningUsd: soma(earning) };
  }, [assets]);

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

  // Runway e saúde: o dinheiro dividido pelo custo lançado NESTE escopo.
  // Sem custo lançado não há runway — e isso não é "infinito", é "a pergunta
  // não se aplica aqui". Um "∞" faria um projeto sem custos declarados parecer
  // mais saudável que um com contas em dia.
  const runwayMeses = monthlyBurnUsd > 0 && isOk(grand) ? grand.value / monthlyBurnUsd : null;
  const k = t.kpi;
  const saude =
    !isOk(grand)
      ? { rotulo: k.incomplete, cor: "text-warning", nota: k.incompleteNote }
      : runwayMeses == null
        ? { rotulo: k.noCosts, cor: "text-foreground-muted", nota: k.noneFiled }
        : runwayMeses >= 12
          ? { rotulo: k.healthy, cor: "text-success", nota: k.healthyNote }
          : runwayMeses >= 6
            ? { rotulo: k.watch, cor: "text-warning", nota: k.watchNote }
            : { rotulo: k.tight, cor: "text-danger", nota: k.tightNote };

  return (
    <div className="space-y-5">
      {/* Quatro respostas antes de qualquer lista: quanto, se está bem, por
          quanto tempo, e onde o dinheiro está guardado. Só quando ninguém
          acima já respondeu — as marcas têm o hero próprio. */}
      {!hideTotal && (
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">
            {k.treasury} · {title}
          </p>
          {isOk(grand) ? (
            <p className="mt-2.5 text-[2rem] font-bold leading-none tracking-tight tabular-nums text-foreground">
              {usd(grand.value)}
            </p>
          ) : (
            <p className="mt-2.5 text-xl font-bold uppercase tracking-tight text-warning">{th.incomplete}</p>
          )}
          <p className="mt-1.5 text-xs text-foreground-muted">
            {multi ? `${walletCount} ${t.wallets.toLowerCase()} · ` : ""}
            {assets.length} {t.assets.toLowerCase()} · {chainCount} {t.networks.toLowerCase()}
          </p>
          {!isOk(grand) && unreadLabels.length > 0 && (
            <p className="mt-1 text-[11px] leading-snug text-warning">
              {th.incompleteNote(unreadLabels.length, walletCount, unreadLabels.join(", "))}
            </p>
          )}
        </div>

        <div className="bg-surface p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">{k.health}</p>
          <p className={`mt-3 text-2xl font-bold tracking-tight ${saude.cor}`}>{saude.rotulo}</p>
          <p className="mt-1.5 text-xs leading-snug text-foreground-muted text-pretty">{saude.nota}</p>
        </div>

        <div className="bg-surface p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">{k.runway}</p>
          <p className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-[1.9rem] font-bold leading-none tracking-tight tabular-nums text-foreground">
              {runwayMeses == null ? "—" : runwayMeses >= 100 ? "99+" : runwayMeses.toFixed(1)}
            </span>
            {runwayMeses != null && <span className="text-sm text-foreground-muted">{k.months}</span>}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-foreground-muted text-pretty">
            {monthlyBurnUsd > 0 ? k.counting(usd(monthlyBurnUsd)) : k.noneFiled}
          </p>
        </div>

        <div className="bg-surface p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">{k.custody}</p>
          <div className="mt-3.5 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-foreground-muted">EVM</span>
              <span className="font-semibold tabular-nums text-foreground">
                {isOk(evmTotal) ? usd(evmTotal.value) : th.incomplete}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-foreground-muted">Hive</span>
              <span className="font-semibold tabular-nums text-foreground">
                {isOk(hiveTotal) ? usd(hiveTotal.value) : th.incomplete}
              </span>
            </div>
          </div>
        </div>
      </div>

      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Liquidez: o que dá para mover hoje, e o que está preso rendendo. */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="px-5 pt-5 pb-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{t.liquidity}</h3>
              <span className="text-[11px] text-foreground-faint">{t.liquidityHint}</span>
            </div>
            <ChainLegend chains={chainsPresent} />
            <SplitBar liquidUsd={split.liquidUsd} earningUsd={split.earningUsd} />
          </div>
      {/* Holdings — à vista primeiro, rendendo depois.
          Separado de propósito: token solto e posição de protocolo têm
          liquidez diferente e não podem ler como a mesma linha. Padrão vindo do
          portfolio do swaps.pro, que usa abas para a mesma distinção. */}
      {(() => {
        const { poeira, liquid, earning, poeiraUsd } = split;
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
                    <ChainDots chains={a.chains} />
                    <span className="text-[10px] uppercase tracking-wider text-foreground-faint">{a.chains.join(" · ")}</span>
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
                    <p className="text-xs font-medium tabular-nums text-foreground-faint" title={t.noPriceSource}>
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
                {/* Controles na propria linha do ativo — e nao numa secao a
                    parte. So aparecem quando as tres coisas valem: a pessoa
                    esta logada, ALGUM Safe segura este ativo, e e um ativo que
                    a gente sabe mover.

                    `untrusted` nunca ganha controle: qualquer um publica um
                    token chamado "USDC", e oferecer "enviar" ao lado dele seria
                    o portal emprestando credibilidade a um impostor.

                    Posicao de protocolo (a.protocol) tambem nao: aquilo e
                    dinheiro em stake, com mecanica propria — sacar de la nao e
                    uma transferencia. */}
                {canPropose && !a.untrusted && !a.protocol && acionavel(a.symbol) && (
                  <div className="ml-10 mt-2 space-y-3 border-l border-accent-border pl-3">
                    {safesDoAtivo(a).map((sw) => (
                      <div key={sw.address}>
                        <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                          <span className="font-semibold text-foreground-muted">{sw.label}</span>
                          <a
                            href={safeAppUrl(sw.address, sw.safeChainId!) ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-foreground-faint hover:text-accent"
                          >
                            {shortAddr(sw.address)} ↗
                          </a>
                        </div>
                        <SafeTreasuryActions
                          safe={sw.address}
                          token={a.symbol.toUpperCase() === "ETH" ? "ETH" : "USDC"}
                          vaultKey={
                            vault && vault.chainId === sw.safeChainId && vault.assetSymbol.toUpperCase() === a.symbol.toUpperCase()
                              ? vault.key
                              : undefined
                          }
                          vaultAssetSymbol={vault?.assetSymbol}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          };
        return (
          <>
            {/*
              PARADO PRIMEIRO, como no desenho. O código tinha "rendendo
              primeiro" com um bom motivo — dinheiro trabalhando é a posição
              sobre a qual se decide. O desenho inverte porque a barra logo
              acima já mostra a proporção, e "o que dá para mover hoje" é a
              pergunta que abre a lista. As duas seções continuam separadas:
              token solto e posição de protocolo têm liquidez diferente.
            */}
            {liquid.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-border px-6 py-2.5">
                  <span className="h-1.5 w-1.5 rounded-sm bg-success" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">{t.idle}</span>
                  <span className="text-[11px] text-foreground-faint">{t.assetCount(liquid.length)}</span>
                </div>
                <ul className="divide-y divide-border">{liquid.map(renderRow)}</ul>
              </>
            )}
            {earning.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-border px-6 py-2.5">
                  <span className="h-1.5 w-1.5 rounded-sm bg-accent" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">{t.earning}</span>
                  <span className="text-[11px] text-foreground-faint">{t.assetCount(earning.length)}</span>
                </div>
                <ul className="divide-y divide-border">{earning.map(renderRow)}</ul>
              </>
            )}
            {poeira.length > 0 && (
              <>
                {dustOpen && <ul className="divide-y divide-border border-t border-border">{poeira.map(renderRow)}</ul>}
                <p className="border-t border-border px-6 py-3 text-[11.5px] leading-relaxed text-foreground-faint">
                  {t.dustHidden(poeira.length, poeiraUsd > 0 ? usd(poeiraUsd) : "")}{" "}
                  <button type="button" onClick={() => setDustOpen((v) => !v)} className="font-semibold text-accent hover:underline">
                    {dustOpen ? t.hideDust : t.showDust}
                  </button>
                </p>
              </>
            )}
          </>
        );
      })()}
        </div>

        {/* Coluna direita: a curva, quem tem o quê, e o mix. */}
        <div className="flex flex-col gap-4">
          {chart}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
              {multi ? t.whoHolds : t.walletsIn(title)}
            </h3>
            <div className="mt-3">
              {holders.map((h, i) => {
                const share = (h.valueUsd / holdersTotal) * 100;
                return (
                  <div key={h.label} className="border-t border-border py-2.5 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-semibold text-foreground">{h.label}</span>
                      <span className="flex items-baseline gap-2.5 tabular-nums">
                        <span className="text-[13px] font-semibold text-foreground">{usd(h.valueUsd)}</span>
                        <span className="w-11 text-right text-[11px] text-foreground-faint">{pct(share)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(share, 0.6)}%`, backgroundColor: colorAt(i) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{t.assetMix}</h3>
              <span className="text-[11px] text-foreground-faint">{t.topShown(Math.min(assetSegments.length, 6), assets.length)}</span>
            </div>
            <div className="mt-3.5">
              <AllocationBar segments={assetSegments} total={listedUsd} />
            </div>
          </div>
        </div>
      </div>

      <WalletsTable groups={groups} t={t} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-wallet detail (kept for drill-down, collapsed by default)
// ---------------------------------------------------------------------------

/**
 * Toda carteira do escopo, numa tabela: nome, projeto, endereço, quantos
 * ativos, quanto vale. A linha abre para o detalhe (EvmCard/HiveCard) — onde
 * vivem o link do Safe, o filtro de poeira e os controles.
 *
 * Substitui o colapso "detalhe por carteira". Lista não é extra, é a resposta
 * a "de quem é o dinheiro" — e ficava atrás de um botão de texto.
 */
function WalletsTable({ groups, t }: { groups: TreasuryGroup[]; t: Dictionary["treasury"]["views"] }) {
  const rows = useMemo(() => {
    const out: { key: string; name: string; project: string; addr: string; assets: string; usd: number; node: ReactNode }[] = [];
    for (const g of groups) {
      for (const w of g.report.evm)
        out.push({ key: `evm:${w.address}`, name: w.label, project: g.name, addr: shortAddr(w.address), assets: t.assetCount(w.tokens.length), usd: w.totalUsd, node: <EvmCard w={w} t={t} /> });
      for (const a of g.report.hive)
        out.push({ key: `hive:${a.account}`, name: a.label, project: g.name, addr: `@${a.account}`, assets: `HP ${num(a.hp, 2)}`, usd: a.usd, node: <HiveCard a={a} t={t} /> });
    }
    return out.sort((x, y) => y.usd - x.usd);
  }, [groups, t]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!rows.length) return null;
  const allOpen = rows.every((r) => open.has(r.key));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const projects = new Set(groups.map((g) => g.slug)).size;
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight text-foreground">{t.wallets}</h3>
          <p className="mt-1 text-[13px] text-foreground-muted">{t.walletsNote(rows.length, projects)}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map((r) => r.key)))}
          className="text-xs font-semibold text-accent hover:underline"
        >
          {allOpen ? t.collapseAll : t.expandAll}
        </button>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map((r) => {
          const aberto = open.has(r.key);
          return (
            <div key={r.key} className="border-t border-border first:border-t-0">
              <button
                type="button"
                onClick={() => toggle(r.key)}
                aria-expanded={aberto}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-elevated sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-foreground">{r.name}</span>
                    <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wider text-foreground-faint">{r.project}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-foreground-faint">{r.addr}</p>
                </div>
                <span className="hidden font-mono text-[11.5px] text-foreground-faint sm:block">{r.assets}</span>
                <span className="flex items-center gap-2">
                  <span className="w-24 text-right text-[15px] font-semibold tabular-nums text-foreground">{usd(r.usd)}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-foreground-faint transition-transform ${aberto ? "rotate-180" : ""}`} />
                </span>
              </button>
              {aberto && <div className="border-t border-border p-4">{r.node}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EvmCard({ w, t }: { w: EvmWalletReport; t: Dictionary["treasury"]["views"] }) {
  // `safeChainId` só existe quando o Safe Transaction Service reconheceu o
  // endereço. Sem ele, tratamos como carteira comum — que é o que quase todo
  // endereço é, e o palpite barato na direção certa.
  const safeUrl = w.safeChainId ? safeAppUrl(w.address, w.safeChainId) : null;
  // Mesma regra de poeira da lista de ativos (isDust), mesmo botão. `note`
  // marca posição de protocolo — essa nunca é poeira. Filtra a LISTA, não o
  // total: a soma disso dá centavos, e o total está certo.
  const [dustOpen, setDustOpen] = useState(false);
  const poeira = w.tokens.filter((tk) => isDust(tk.valueUsd, !!tk.note));
  const visiveis = dustOpen ? w.tokens : w.tokens.filter((tk) => !isDust(tk.valueUsd, !!tk.note));
  const poeiraUsd = poeira.reduce((sum, tk) => sum + (tk.valueUsd ?? 0), 0);
  const segs =
    w.totalUsd > 0
      ? toSegments(w.tokens.map((tk) => ({ label: `${tk.symbol}·${tk.chain}`, valueUsd: tk.valueUsd ?? 0 })), t.others)
      : [];
  return (
    <div className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{w.label}</p>
          {/* Multisig abre no app.safe.global, carteira comum na Zerion. Um Safe
              num explorador de carteira mostra saldo e esconde justamente o que
              faz dele um Safe: donos, threshold, fila de assinaturas. */}
          <a
            href={safeUrl ?? zerionWalletUrl(w.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-foreground-subtle transition-colors hover:text-accent"
            title={`${w.address} — abrir ${safeUrl ? "no Safe" : "na Zerion"}`}
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
          ⚠ {t.loadFailed} {w.failedChains.join(", ")} {t.unknownNotZero}
        </p>
      )}
      {visiveis.length > 0 ? (
        <div className="mt-4 space-y-2">
          {visiveis.map((tk, i) => (
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
      {/* Fora do ternário de propósito: uma carteira só de poeira cai no ramo
          "sem saldo" e ainda precisa do botão que a mostra. */}
      {poeira.length > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-foreground-faint">
          {t.dustHidden(poeira.length, poeiraUsd > 0 ? usd(poeiraUsd) : "")}{" "}
          <button type="button" onClick={() => setDustOpen((v) => !v)} className="font-semibold text-accent hover:underline">
            {dustOpen ? t.hideDust : t.showDust}
          </button>
        </p>
      )}
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

export function TreasuryViews({
  groups,
  hideSelector = false,
  hideTotal = false,
  canPropose = false,
  vault,
  monthlyBurnUsd = 0,
  chart,
}: {
  groups: TreasuryGroup[];
  hideSelector?: boolean;
  hideTotal?: boolean;
  /** O gráfico do escopo. Vem de fora porque quem sabe o escopo é quem filtra. */
  chart?: ReactNode;
  /** Custo fixo mensal do escopo — alimenta saúde e runway. */
  monthlyBurnUsd?: number;
  /** Sessão válida — só então os botões de propor aparecem. A trava de verdade
   *  é do servidor (a action confere a sessão); isto evita oferecer um botão
   *  que só poderia falhar. */
  canPropose?: boolean;
  /** O cofre ligado aos multisigs. Desce do servidor porque community-vaults
   *  é `server-only`. */
  vault?: { key: string; assetSymbol: string; chainId: number };
}) {
  const tr = useT().treasury;
  const t = tr.views;
  const [view, setView] = useState<string>("all");
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

      <Overview groups={visible} title={title} hideTotal={hideTotal} canPropose={canPropose} vault={vault} monthlyBurnUsd={monthlyBurnUsd} chart={chart} />


      <div>
        {/* Carteiras vivem dentro do Overview agora — tabela, não colapso. */}
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
