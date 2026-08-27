"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { TreasurySeries } from "@/lib/treasury-history";
import { isOk, ok, type Reading } from "@/lib/reading";
import { fetchWalletChart } from "@/app/actions/treasury-chart";

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
}) {
  // Começa no que TEM dado: as carteiras só acumulam ponto a partir do segundo
  // tick, então logo depois do deploy a única série com linha é a de streams.
  const [src, setSrc] = useState<"wallets" | "streams">(
    isOk(wallets) && wallets.value.length ? "wallets" : "streams",
  );
  const [period, setPeriod] = useState("month");
  const [live, setLive] = useState<TreasurySeries[] | null>(null);
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

  // A leitura escolhida, ainda como leitura. Só vira array depois de o
  // componente ter decidido o que fazer com cada estado.
  const reading: Reading<TreasurySeries[]> = useMemo(
    () => (src === "wallets" ? (live ? ok(live) : wallets) : streams),
    [src, live, wallets, streams],
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
            ⚠ O histórico não pôde ser lido — {reading.reason}. Isto NÃO é ausência de histórico.
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">
            Ainda não há histórico no portal — o cron grava um ponto por hora e a linha aparece a partir do segundo dia.
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

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Saldo por tesouro</h3>
          <p className="text-[11px] text-foreground-subtle">
            {src === "wallets" ? (live ? "Zerion · ao vivo" : "snapshot do portal") : "arrecadação por projeto"} · {allDays.length}{" "}
            dias · fechamento diário ·{" "}
            <span className="font-medium text-foreground-muted">{log ? "escala logarítmica" : "escala linear"}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {src === "wallets" && (
            <select
              value={period}
              onChange={(e) => changePeriod(e.target.value)}
              disabled={loading}
              aria-label="Período do gráfico"
              className="rounded-lg border border-border bg-surface-elevated px-2 py-1 text-[11px] font-medium text-foreground-muted focus:border-accent-border focus:outline-none disabled:opacity-50"
            >
              <option value="day">24h</option>
              <option value="week">7 dias</option>
              <option value="month">1 mês</option>
              <option value="3months">3 meses</option>
              <option value="year">1 ano</option>
              <option value="max">tudo</option>
            </select>
          )}
          {src === "wallets" && (
            <button
              type="button"
              onClick={() => pull(period)}
              disabled={loading}
              title="Ler o histórico na Zerion — uma requisição por carteira"
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
              {src === "wallets" ? "ver arrecadação" : "ver carteiras"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLog((v) => !v)}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {log ? "ver linear" : "ver log"}
          </button>
          <button
            type="button"
            onClick={() => setTable((v) => !v)}
            aria-pressed={table}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {table ? "ver gráfico" : "ver tabela"}
          </button>
        </div>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-foreground-faint">
                <th className="py-1.5 pr-3 font-semibold">Tesouro</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Atual</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Máximo</th>
                <th className="py-1.5 text-right font-semibold">Pontos</th>
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
          aria-label={`Saldo por tesouro ao longo de ${allDays.length} dias`}
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
        </svg>
      )}

      {hoverDay && !table && (
        <div className="mt-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">
            {hoverDay.length > 10 ? new Date(hoverDay).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : hoverDay}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {series.map((s) => {
              const pt = s.points.find((p) => p.t === hoverDay);
              return (
                <span key={s.cardId} className="inline-flex items-center gap-1.5 text-[11px]">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf.get(s.cardId) }} />
                  <span className="text-foreground-muted">{s.label}</span>
                  <span className="tabular-nums font-medium text-foreground">{pt ? money(pt.usd) : "—"}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {err && <p className="mt-2 text-[11px] text-danger">⚠ {err}</p>}
      {src === "wallets" && liveFailed.length > 0 && (
        <p className="mt-2 text-[11px] text-warning">
          ⚠ não consegui ler {liveFailed.join(", ")} — ausente da linha, o que NÃO é o mesmo que zero
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
                {allZero ? "sem saldo no período" : money(s.latestUsd)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
