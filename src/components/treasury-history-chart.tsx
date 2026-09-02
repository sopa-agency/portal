"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { TreasurySeries } from "@/lib/treasury-history";
import { isOk, ok, type Reading } from "@/lib/reading";
import { fetchWalletChart } from "@/app/actions/treasury-chart";
import { reconcileWithTruth } from "@/lib/reconcile-series";
import { RefreshSkeleton } from "@/components/treasury-refresh";
import { useLocale } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

// Uma linha por tesouro, sobrepostas. Substitui a barra empilhada, que só sabia
// dizer a composição de HOJE e não mostrava movimento nenhum.
//
// Por que existe um alternador de escala: medido nos dados reais, a Gnars está
// em ~$31k e a skatehive em ~$5 — spread de milhares de vezes. Em escala linear
// as menores viram uma reta colada no eixo, visualmente idêntica a "sem dado".
// O padrão é escolhido pelo spread e o rótulo diz qual está ativa: um gráfico
// log que não se anuncia é pior que um linear ilegível.

const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const W = 760;
const H = 260;
const PAD = { t: 14, r: 92, b: 26, l: 52 };

const money = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n >= 1 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

export function TreasuryHistoryChart({
  wallets,
  streams,
  failed = [],
  initialLive,
  initialSyncedAt,
}: {
  /**
   * Saldo por CARTEIRA de tesouro, como LEITURA.
   *
   * Antes chegava como array e a página fazia `.catch(() => [])`: banco fora do
   * ar desenhava a mesma tela que "ainda não há histórico". Os dois estados
   * pedem coisas opostas de quem olha — um é esperar, o outro é investigar.
   */
  wallets: Reading<TreasurySeries[]>;
  /** Arrecadação por card do org-chart. Fica disponível porque tem histórico
   *  mais longo, mas rotulado: nessa visão o Safe da SOPA aparece sob a Gnars,
   *  que é como o org-chart classifica aquele stream — e ler isso como "tesouro
   *  da Gnars" seria errado. */
  streams: Reading<TreasurySeries[]>;
  /** Carteiras cuja leitura FALHOU. Aparecem nomeadas: some da linha é
   *  diferente de valer zero, e o usuário precisa saber qual é qual. */
  failed?: string[];
  /**
   * O último sync que alguém pediu, vindo do banco.
   *
   * Sem isto a pessoa tinha que clicar "sincronizar" a cada carregamento — o
   * resultado era guardado e não era lido de volta. Eu tinha cortado esta volta
   * de propósito, porque a série da Zerion trazia o stake como queda; a queda
   * agora é corrigida contra o snapshot (ver reconcileWithTruth), então guardar
   * e restaurar voltou a ser seguro.
   */
  initialLive?: TreasurySeries[];
  /** Quando esse sync foi feito. Dado guardado que se anuncia não é dado velho
   *  disfarçado de fresco. */
  initialSyncedAt?: string | null;
}) {
  const { locale, t: dict } = useLocale();
  const t = dict.treasury.chart;
  // Começa no que TEM dado: as carteiras só acumulam ponto a partir do segundo
  // tick, então logo depois do deploy a única série com linha é a de streams.
  const [src, setSrc] = useState<"wallets" | "streams">(
    isOk(wallets) && wallets.value.length ? "wallets" : "streams",
  );
  // Três meses por padrão: um mês mostra pouco movimento num tesouro que se
  // move devagar, e a pergunta que as pessoas fazem olhando isto é de trimestre.
  const [period, setPeriod] = useState("3months");
  // A série CRUA da Zerion. A corrigida é derivada logo abaixo — guardar a
  // corrigida no estado faria a correção rodar sobre ela mesma a cada render.
  const [live, setLive] = useState<TreasurySeries[] | null>(initialLive?.length ? initialLive : null);
  const [syncedAt] = useState<string | null>(initialSyncedAt ?? null);
  const [liveFailed, setLiveFailed] = useState<string[]>(failed);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The Zerion read is EXPLICIT. One request per wallet per period, so having
  // every page view pull it burned quota on a number nobody had asked for. The
  // chart opens on the snapshot the cron already writes — free, ours, no
  // network — and this button is what buys the depth Zerion has and we don't.
  const pull = async (p: string) => {
    setLoading(true);
    setErr(null);
    const r = await fetchWalletChart(p);
    setLoading(false);
    if (r.ok) {
      setLive(r.series);
      setLiveFailed(r.failed);
    } else {
      setErr(r.error);
    }
  };

  const changePeriod = async (next: string) => {
    setPeriod(next);
    // Only once the user has opted into live data does changing the period
    // fetch on its own; before that the period just arms the button.
    if (live) await pull(next);
  };

  // A CORREÇÃO DO STAKE.
  //
  // A série da Zerion não conta posição de protocolo, então o dia do stake
  // aparece como queda — a SkateHive terminava em US$ 285 com US$ 2.228 nas
  // carteiras. Antes isso virava um aviso amarelo com os números escritos à
  // mão, e a linha continuava mentindo. Agora o snapshot (que lê a carteira
  // inteira) dá o total verdadeiro de hoje e a série é reconciliada contra ele.
  // Ver src/lib/reconcile-series.ts — inclusive o caso em que NÃO dá para
  // corrigir, que continua sendo declarado em vez de escondido.
  const reconciliado = useMemo(
    () => (live && isOk(wallets) ? reconcileWithTruth(live, wallets.value) : null),
    [live, wallets],
  );
  const liveCorrigido = reconciliado?.series ?? live;

  // A leitura escolhida, ainda como leitura. Só vira array depois de o
  // componente ter decidido o que fazer com cada estado.
  const reading: Reading<TreasurySeries[]> = useMemo(
    () => (src === "wallets" ? (liveCorrigido ? ok(liveCorrigido) : wallets) : streams),
    [src, liveCorrigido, wallets, streams],
  );
  // Memoizado porque um array novo a cada render invalidaria todos os useMemo
  // abaixo (cores, eixo, spread) e recalcularia o gráfico inteiro por nada.
  const series = useMemo(() => (isOk(reading) ? reading.value : []), [reading]);
  // A COR é fixada pelo cardId ordenado, NÃO pela ordem de exibição (que segue
  // valor). Ordenar por valor e colorir por posição repintaria as linhas toda
  // vez que um tesouro passasse o outro.
  const colorOf = useMemo(() => {
    const ids = [...series].map((s) => s.cardId).sort();
    return new Map(ids.map((id, i) => [id, SLOTS[i % SLOTS.length]]));
  }, [series]);

  const allDays = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort(),
    [series],
  );

  const spread = useMemo(() => {
    const tops = series.map((s) => Math.max(...s.points.map((p) => p.usd))).filter((v) => v > 0);
    if (tops.length < 2) return 1;
    return Math.max(...tops) / Math.min(...tops);
  }, [series]);

  const [log, setLog] = useState(spread > 50);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const maxUsd = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.usd)));
  // Piso do log: escala logarítmica não representa zero. Em vez de fingir um
  // valor, a série inteiramente zerada não é desenhada e a legenda diz isso.
  const FLOOR = 0.01;
  const y = (v: number) => {
    const inner = H - PAD.t - PAD.b;
    if (!log) return PAD.t + inner - (v / maxUsd) * inner;
    const lv = Math.log10(Math.max(v, FLOOR));
    const lo = Math.log10(FLOOR);
    const hi = Math.log10(Math.max(maxUsd, FLOOR * 10));
    return PAD.t + inner - ((lv - lo) / (hi - lo)) * inner;
  };
  const x = (day: string) => {
    const i = allDays.indexOf(day);
    const inner = W - PAD.l - PAD.r;
    return PAD.l + (allDays.length < 2 ? inner / 2 : (i / (allDays.length - 1)) * inner);
  };

  const ticks = log ? [FLOOR, 1, 100, 10_000] .filter((t) => t <= maxUsd * 10) : [0, maxUsd / 2, maxUsd];


  /**
   * VARIAÇÃO LÍQUIDA — e o nome é a definição, não um rótulo simpático.
   *
   * É a diferença do total entre uma foto e a anterior. NÃO é "quanto entrou":
   * o saldo também muda porque o preço dos ativos mudou, e uma barra positiva
   * pode ser ETH subindo sem ninguém ter transferido nada. Também não separa
   * entrada de saída — o que sobe e o que desce no mesmo dia chega aqui já
   * somado, e some um dentro do outro.
   *
   * Para responder "quanto entrou" é preciso ler transferência, não saldo. A
   * especificação disso está em docs/indexador-fluxo-tesouro.md.
   *
   * Só existe barra onde as DUAS fotos existem. Dia sem a foto anterior não
   * vira zero: fica sem barra, porque não saber o quanto variou é diferente de
   * ter variado nada — e num painel de dinheiro essa diferença é a que importa.
   */
  const variation = useMemo(() => {
    const totalOf = (day: string) => {
      const vals = series
        .map((s) => s.points.find((p) => p.t === day)?.usd)
        .filter((v): v is number => typeof v === "number");
      return vals.length ? { usd: vals.reduce((a, b) => a + b, 0), n: vals.length } : null;
    };
    const out: { t: string; delta: number | null }[] = [];
    for (let i = 0; i < allDays.length; i++) {
      if (i === 0) {
        out.push({ t: allDays[i], delta: null });
        continue;
      }
      const cur = totalOf(allDays[i]);
      const prev = totalOf(allDays[i - 1]);
      // Se o número de séries lidas mudou entre as duas fotos, a diferença
      // mediria a mudança da AMOSTRA e não do dinheiro. Isso não é variação.
      out.push({
        t: allDays[i],
        delta: cur && prev && cur.n === prev.n ? cur.usd - prev.usd : null,
      });
    }
    return out;
  }, [series, allDays]);

  const maxAbsDelta = Math.max(
    1,
    ...variation.map((v) => (v.delta == null ? 0 : Math.abs(v.delta))),
  );
  const VH = 88;
  const VPAD = { t: 12, b: 18 };
  const vy = (d: number) => {
    const inner = VH - VPAD.t - VPAD.b;
    const zero = VPAD.t + inner / 2;
    return zero - (d / maxAbsDelta) * (inner / 2);
  };
  const semLeitura = variation.filter((v) => v.delta == null).length - (allDays.length ? 1 : 0);

  if (!series.length) {
    // Três estados, três FORMATOS — não só três cores. Quem lê rápido lê forma:
    // a falha é uma placa com moldura de aviso e um motivo; a espera é texto
    // corrido sem moldura. Antes as duas eram a mesma frase cinza, e "o banco
    // caiu" pedia investigar enquanto "ainda não deu tempo" pedia esperar.
    const failed = reading.state === "unread";
    return (
      <div
        className={`rounded-xl border p-8 text-center ${
          failed ? "border-warning/40 bg-warning/10" : "border-border bg-surface"
        }`}
      >
        {failed ? (
          <p className="text-sm font-semibold text-warning">
            {t.unread(reading.reason)}
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">
            {t.empty}
            {reading.state === "insufficient" ? ` (${reading.note})` : ""}
          </p>
        )}
        {/* The button lives HERE too: without it, a portal whose snapshot table
            is still empty had no way to reach the one source that does have
            history, which is precisely when it's most needed. */}
        <button
          type="button"
          onClick={() => pull(period)}
          disabled={loading}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          buscar na Zerion
        </button>
        {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
      </div>
    );
  }

  const hoverDay = hover != null ? allDays[hover] : null;

  /** A data do ponto sob o cursor, curta — cabe na etiqueta do topo. */
  const hoverLabelDate = hoverDay
    ? hoverDay.length > 10
      ? new Date(hoverDay).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : hoverDay
    : "";

  /**
   * Onde cada valor é escrito sobre a linha.
   *
   * Duas coisas que o SVG não resolve sozinho:
   *
   *   LADO — perto da borda direita a etiqueta sairia do quadro, então ela vira
   *   para a esquerda do cursor. O ponto de virada é 62% da largura útil, que é
   *   onde a etiqueta mais larga ainda cabe.
   *
   *   COLISÃO — duas séries próximas escreveriam uma por cima da outra. As
   *   etiquetas são empurradas para baixo até ficarem a 19px uma da outra: elas
   *   deixam de apontar o pixel exato, mas continuam na ordem das linhas, que é
   *   o que se lê. Ilegível seria pior que deslocado.
   */
  const hoverLabels = (() => {
    if (!hoverDay) return [] as { cardId: string; bx: number; by: number; bw: number; text: string; color: string }[];
    const hx = x(hoverDay);
    const paraEsquerda = hx > PAD.l + (W - PAD.l - PAD.r) * 0.62;
    const brutos = series
      .map((s) => {
        const pt = s.points.find((p) => p.t === hoverDay);
        if (!pt || (log && pt.usd <= 0)) return null;
        const text = money(pt.usd);
        const bw = text.length * 6.1 + 12;
        return {
          cardId: s.cardId,
          y0: y(pt.usd),
          bw,
          text,
          color: colorOf.get(s.cardId) ?? "var(--border-strong)",
          bx: paraEsquerda ? hx - 10 - bw : hx + 10,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.y0 - b.y0);

    const MIN = 19;
    let ultimo = -Infinity;
    return brutos.map((b) => {
      const by = Math.max(b.y0, ultimo + MIN, PAD.t + 10);
      ultimo = by;
      return { cardId: b.cardId, bx: b.bx, by: Math.min(by, H - PAD.b - 4), bw: b.bw, text: b.text, color: b.color };
    });
  })();

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
          <p className="text-[11px] text-foreground-subtle">
            {src === "wallets" ? (live ? t.srcLive : t.srcSnapshot) : t.srcRevenue} · {t.days(allDays.length)} ·{" "}
            <span className="font-medium text-foreground-muted">{log ? t.scaleLog : t.scaleLinear}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {src === "wallets" && (
            <select
              value={period}
              onChange={(e) => changePeriod(e.target.value)}
              disabled={loading}
              aria-label={t.periodLabel}
              className="rounded-lg border border-border bg-surface-elevated px-2 py-1 text-[11px] font-medium text-foreground-muted focus:border-accent-border focus:outline-none disabled:opacity-50"
            >
              <option value="day">{t.p24h}</option>
              <option value="week">{t.pWeek}</option>
              <option value="month">{t.pMonth}</option>
              <option value="3months">{t.p3Months}</option>
              <option value="year">{t.pYear}</option>
              <option value="max">{t.pMax}</option>
            </select>
          )}
          {src === "wallets" && (
            <button
              type="button"
              onClick={() => pull(period)}
              disabled={loading}
              title={t.readZerion}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {live ? "atualizar" : "sincronizar"}
            </button>
          )}
          {isOk(wallets) && wallets.value.length > 0 && isOk(streams) && streams.value.length > 0 && (
            <button
              type="button"
              onClick={() => setSrc((v) => (v === "wallets" ? "streams" : "wallets"))}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              {src === "wallets" ? t.seeRevenue : t.seeWallets}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLog((v) => !v)}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {log ? t.seeLinear : t.seeLog}
          </button>
          <button
            type="button"
            onClick={() => setTable((v) => !v)}
            aria-pressed={table}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {table ? t.seeChart : t.seeTable}
          </button>
        </div>
      </div>

      {/* O esqueleto cobre só a ÁREA DO DESENHO (ou da tabela). Título, seletor
          de período e botões continuam clicáveis durante a atualização —
          esconder o comando junto com o dado tira da pessoa a chance de trocar
          de período enquanto espera. */}
      <RefreshSkeleton className="min-h-[260px]">
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-foreground-faint">
                <th className="py-1.5 pr-3 font-semibold">{t.thTreasury}</th>
                <th className="py-1.5 pr-3 text-right font-semibold">{t.thCurrent}</th>
                <th className="py-1.5 pr-3 text-right font-semibold">{t.thMax}</th>
                <th className="py-1.5 text-right font-semibold">{t.thPoints}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.cardId} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorOf.get(s.cardId) }} />
                    <span className="text-foreground">{s.label}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-foreground">{money(s.latestUsd)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-foreground-muted">
                    {money(Math.max(...s.points.map((p) => p.usd)))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-foreground-subtle">{s.points.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t.ariaChart(allDays.length)}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const inner = W - PAD.l - PAD.r;
            const i = Math.round(((px - PAD.l) / inner) * (allDays.length - 1));
            setHover(i >= 0 && i < allDays.length ? i : null);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-foreground-faint" style={{ fontSize: 9 }}>
                {t === FLOOR ? "0" : money(t)}
              </text>
            </g>
          ))}

          {hoverDay && (
            <line x1={x(hoverDay)} x2={x(hoverDay)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
          )}

          {series.map((s) => {
            const drawable = s.points.filter((p) => !log || p.usd > 0);
            const allZero = s.points.every((p) => p.usd === 0);
            if (allZero || drawable.length < 2) return null;
            const d = drawable.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.usd).toFixed(1)}`).join(" ");
            const last = drawable[drawable.length - 1];
            return (
              <g key={s.cardId}>
                <path d={d} fill="none" stroke={colorOf.get(s.cardId)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* rótulo direto — obrigatório: 3 das 5 cores ficam abaixo de 3:1
                    contra a superfície clara, então a cor não pode ser o único
                    canal de identidade */}
                <text
                  x={x(last.t) + 6}
                  y={y(last.usd) + 3}
                  className="fill-foreground-muted"
                  style={{ fontSize: 10, fontWeight: 600 }}
                >
                  {s.label}
                </text>
              </g>
            );
          })}

          {hoverDay &&
            series.map((s) => {
              const pt = s.points.find((p) => p.t === hoverDay);
              if (!pt || (log && pt.usd <= 0)) return null;
              return (
                <circle
                  key={s.cardId}
                  cx={x(hoverDay)}
                  cy={y(pt.usd)}
                  r={4}
                  fill={colorOf.get(s.cardId)}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              );
            })}

          {/*
            OS NÚMEROS FICAM SOBRE A LINHA, dentro do SVG.
            
            Antes eles saíam numa caixa ABAIXO do gráfico, e essa caixa entrava
            no fluxo: aparecia no hover, empurrava o painel de variação e a
            legenda para baixo, e o cartão inteiro crescia. Passar o mouse
            deformava a página — o pior tipo de tooltip, porque move justamente
            o que a pessoa está tentando ler.
            
            Dentro do SVG não há reflow possível: o viewBox é o mesmo com e sem
            hover, então o cartão tem exatamente a mesma altura sempre.
          */}
          {hoverDay &&
            hoverLabels.map((L) => (
              <g key={L.cardId} pointerEvents="none">
                <rect
                  x={L.bx}
                  y={L.by - 9}
                  width={L.bw}
                  height={18}
                  rx={5}
                  fill="var(--surface-elevated)"
                  stroke={L.color}
                  strokeWidth={1}
                  opacity={0.97}
                />
                <text
                  x={L.bx + 6}
                  y={L.by + 4}
                  className="fill-foreground"
                  style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                >
                  {L.text}
                </text>
              </g>
            ))}

          {hoverDay && (
            <g pointerEvents="none">
              <rect
                x={Math.min(Math.max(x(hoverDay) - 38, PAD.l), W - PAD.r - 76)}
                y={1}
                width={76}
                height={15}
                rx={4}
                fill="var(--surface-elevated)"
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={Math.min(Math.max(x(hoverDay) - 38, PAD.l), W - PAD.r - 76) + 38}
                y={12}
                textAnchor="middle"
                className="fill-foreground-subtle"
                style={{ fontSize: 9 }}
              >
                {hoverLabelDate}
              </text>
            </g>
          )}
        </svg>
      )}
      </RefreshSkeleton>

      {/* ── Variação, colada embaixo, mesmo eixo do tempo ────────────────── */}
      {!table && series.length > 0 && (
        <div className="mt-1 border-t border-border pt-2">
          {/*
            A ressalva vem ANTES do gráfico e é a definição do número, não um
            rodapé. Quem bate o olho no painel tem que já saber o que está
            olhando: uma barra positiva aqui pode ser preço subindo, não
            dinheiro entrando.
          */}
          <p className="mb-1.5 text-[11px] leading-relaxed text-foreground-subtle">
            <span className="font-semibold text-foreground-muted">{t.deltaTitle}</span> {rich(t.deltaBody)}
          </p>
          <svg
            viewBox={`0 0 ${W} ${VH}`}
            className="w-full"
            role="img"
            aria-label={t.ariaDelta}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const inner = W - PAD.l - PAD.r;
              const i = Math.round(((px - PAD.l) / inner) * (allDays.length - 1));
              setHover(i >= 0 && i < allDays.length ? i : null);
            }}
          >
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={vy(0)}
              y2={vy(0)}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text x={PAD.l - 6} y={vy(0) + 3} textAnchor="end" className="fill-foreground-faint" style={{ fontSize: 9 }}>
              0
            </text>
            <text x={PAD.l - 6} y={vy(maxAbsDelta) + 3} textAnchor="end" className="fill-foreground-faint" style={{ fontSize: 9 }}>
              {money(maxAbsDelta)}
            </text>
            <text x={PAD.l - 6} y={vy(-maxAbsDelta) + 3} textAnchor="end" className="fill-foreground-faint" style={{ fontSize: 9 }}>
              −{money(maxAbsDelta)}
            </text>

            {hoverDay && (
              <line
                x1={x(hoverDay)}
                x2={x(hoverDay)}
                y1={VPAD.t}
                y2={VH - VPAD.b}
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* O delta do dia também vira etiqueta sobre a barra, pelo mesmo
                motivo: nada pode mudar a altura do cartão no hover. */}
            {hoverDay && (() => {
              const v = variation.find((z) => z.t === hoverDay);
              if (!v) return null;
              const txt = v.delta == null ? t.noReading : `${v.delta >= 0 ? "+" : "−"}${money(Math.abs(v.delta))}`;
              const bw = txt.length * 6.1 + 12;
              const hx = x(v.t);
              const bx = hx > PAD.l + (W - PAD.l - PAD.r) * 0.62 ? hx - 8 - bw : hx + 8;
              return (
                <g pointerEvents="none">
                  <rect x={bx} y={VPAD.t - 2} width={bw} height={17} rx={5}
                    fill="var(--surface-elevated)" stroke="var(--border-strong)" strokeWidth={1} opacity={0.97} />
                  <text x={bx + 6} y={VPAD.t + 10} className="fill-foreground"
                    style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{txt}</text>
                </g>
              );
            })()}

            {variation.map((v) => {
              if (v.delta == null) return null;
              const bw = Math.max(
                3,
                Math.min(18, (W - PAD.l - PAD.r) / Math.max(allDays.length, 1) - 3),
              );
              const top = v.delta >= 0 ? vy(v.delta) : vy(0);
              const h = Math.max(1, Math.abs(vy(v.delta) - vy(0)));
              return (
                <rect
                  key={v.t}
                  x={x(v.t) - bw / 2}
                  y={top}
                  width={bw}
                  height={h}
                  rx={2}
                  fill={v.delta >= 0 ? "var(--success)" : "var(--danger)"}
                  opacity={0.85}
                />
              );
            })}
          </svg>
          {semLeitura > 0 && (
            <p className="mt-1 text-[11px] text-warning">
              {t.gaps(semLeitura)}
            </p>
          )}
        </div>
      )}

      {/*
        A caixa de valores que ficava AQUI saiu.
        
        Ela era um <div> no fluxo: nascia no hover e empurrava o painel de
        variação e a legenda para baixo, fazendo o cartão inteiro crescer.
        Passar o mouse deformava a página — e deformava justamente o que a
        pessoa estava tentando ler. Os números agora são desenhados sobre a
        linha, dentro do SVG, onde não existe reflow.
      */}

      {/* O aviso agora RELATA a correção em vez de pedir desculpa por ela.
          Antes esta caixa trazia dois números escritos à mão no código e
          mandava a pessoa recarregar a página. */}
      {live && reconciliado && reconciliado.corrigidos.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-foreground-faint">
          {t.reconciled(reconciliado.corrigidos.map((c) => `${c.label} +${money(c.usd)}`).join(" · "))}
        </p>
      )}
      {live && reconciliado && reconciliado.naoCorrigidos.length > 0 && (
        <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
          {t.notReconciled(reconciliado.naoCorrigidos.map((c) => `${c.label} (${money(c.usd)})`).join(", "))}
        </p>
      )}
      {err && <p className="mt-2 text-[11px] text-danger">⚠ {err}</p>}
      {src === "wallets" && liveFailed.length > 0 && (
        <p className="mt-2 text-[11px] text-warning">
          {t.liveFailed(liveFailed.join(", "))}
        </p>
      )}

      {/* legenda — sempre presente com 2+ séries */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
        {series.map((s) => {
          const allZero = s.points.every((p) => p.usd === 0);
          return (
            <span key={s.cardId} className="inline-flex items-center gap-1.5 text-[11px]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf.get(s.cardId) }} />
              <span className="text-foreground-muted">{s.label}</span>
              <span className="tabular-nums text-foreground-subtle">
                {allZero ? t.noBalance : money(s.latestUsd)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
