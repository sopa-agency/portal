"use client";

import { useState, type ReactNode } from "react";
import { Radio, Users2, Wallet } from "lucide-react";

// Membros tab shell (from the Claude Design redesign): two sub-views —
// "Painel · ao vivo" (what's happening, for anyone) and "Controles · admin"
// (what you can do, step by step). Copy is deliberately plain-Portuguese:
// reserva = stream buffer, cofre = staking, pesos = units, torneira = flow.

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
// Streams accrue in tiny increments — show enough decimals for them to be visible.
const fmtTiny = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(6)}` : usd(n));
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const initials = (s: string) => s.replace(/^@/, "").slice(0, 2).toUpperCase();

/** Hive PFP for a member handle, falling back to colored initials if it 404s. */
function MemberAvatar({ handle, color, size = 32 }: { handle: string; color: string; size?: number }) {
  const [ok, setOk] = useState(true);
  const user = handle.replace(/^@/, "");
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold"
      style={{ height: size, width: size, backgroundColor: `${color}22`, color, border: `1px solid ${color}66` }}
    >
      {initials(handle)}
      {ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://images.hive.blog/u/${user}/avatar`}
          alt=""
          aria-hidden
          onError={() => setOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48"];

export type MemberRow = {
  label: string;
  address: string;
  units: number;
  connected: boolean;
  /** Total already streamed to them since joining. */
  receivedUsd?: number;
  /** How much of that they already pulled out. */
  claimedUsd?: number;
};

function Stat({ label, value, sub, hint, tone = "text-foreground" }: { label: string; value: string; sub?: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
        {label}
        {hint && (
          <span title={hint} className="cursor-help rounded-full border border-border px-1 leading-none text-[9px]">?</span>
        )}
      </div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums ${tone}`}>
        {value}
        {sub && <span className="ml-0.5 text-sm font-medium text-foreground-faint">{sub}</span>}
      </div>
    </div>
  );
}

/** "Quem recebe o quê" — the payee list with live share and per-month value. */
function WhoGetsWhat({ members, monthlyUsd, connectSlot }: { members: MemberRow[]; monthlyUsd: number | null; connectSlot?: ReactNode }) {
  const active = members.filter((m) => m.units > 0);
  const total = active.reduce((s, m) => s + m.units, 0);
  if (!active.length) return null;
  const notConnected = active.filter((m) => !m.connected).length;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Quem recebe o quê</h2>
        <span className="text-xs text-foreground-faint">
          {active.length} membros ·{" "}
          <span title="Peso = a fatia de cada um. A fatia é o peso dividido pelo total." className="cursor-help underline decoration-dotted">
            {total} pesos
          </span>
        </span>
      </div>

      {notConnected > 0 && (
        <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
          {notConnected} {notConnected === 1 ? "membro ainda não conectou a carteira" : "membros ainda não conectaram a carteira"} — a fatia deles acumula, mas não pinga em tempo real. É um clique, uma vez só.
          {connectSlot && <div className="mt-2">{connectSlot}</div>}
        </div>
      )}

      <ul className="space-y-2">
        {active.map((m, i) => {
          const share = total > 0 ? (m.units / total) * 100 : 0;
          const color = PALETTE[i % PALETTE.length];
          return (
            <li key={m.address} className="flex items-center gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-2.5">
              <MemberAvatar handle={m.label} color={color} />

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{m.label}</div>
                <div className="font-mono text-[11px] text-foreground-faint">{shortAddr(m.address)}</div>
              </div>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                  m.connected ? "bg-success/15 text-success" : "bg-foreground/10 text-foreground-muted"
                }`}
              >
                {m.connected ? "recebendo" : "acumulando"}
              </span>
              <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-border sm:block">
                <div className="h-full rounded-full" style={{ width: `${Math.max(share, 2)}%`, backgroundColor: color }} />
              </div>
              <div className="w-12 shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums text-foreground">{pct(share)}</div>
                <div className="text-[10px] tabular-nums text-foreground-faint">
                  {monthlyUsd != null ? `${usd((monthlyUsd * share) / 100)}/mês` : "—"}
                </div>
              </div>
              <div className="w-24 shrink-0 border-l border-border pl-2 text-right">
                <div className="text-[10px] uppercase tracking-wider text-foreground-faint">acumulado</div>
                <div className="text-sm font-semibold tabular-nums text-success">{fmtTiny(m.receivedUsd ?? 0)}</div>
                <div className="text-[10px] tabular-nums text-foreground-faint">
                  {(m.claimedUsd ?? 0) > 0 ? `${fmtTiny(m.claimedUsd ?? 0)} sacado` : "nada sacado"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function MembersTab({
  canEdit,
  members,
  monthlyUsd,
  streaming,
  runwayDays,
  bufferUsd,
  flow,
  sustainability,
  connect,
  steps,
}: {
  canEdit: boolean;
  members: MemberRow[];
  monthlyUsd: number | null;
  streaming: boolean;
  runwayDays: number | null;
  bufferUsd: number;
  /** The animated flow view. */
  flow: ReactNode;
  /** The sustainability gauge. */
  sustainability: ReactNode;
  /** The connect-your-wallet action. */
  connect: ReactNode;
  /** Ordered admin steps: [title, node][] — rendered as numbered cards. */
  steps: { title: string; node: ReactNode }[];
}) {
  const [tab, setTab] = useState<"painel" | "controles">("painel");
  const connectedCount = members.filter((m) => m.units > 0 && m.connected).length;
  const activeCount = members.filter((m) => m.units > 0).length;

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {([["painel", "Painel · ao vivo", Radio], ["controles", "Controles · admin", Users2]] as const).map(([id, label, Icon]) =>
            id === "controles" && !canEdit ? null : (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  tab === id ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ),
          )}
        </div>
        <span className="text-[11px] text-foreground-faint">Painel = o que está acontecendo · Controles = o que você pode fazer</span>
      </div>

      {tab === "painel" ? (
        <div className="space-y-5">
          {/* The payroll rails are fully wired, but the rate can be so small that
              the panel reads as a production payroll when it is really a dry run.
              Say so out loud instead of letting the bars imply otherwise. */}
          {streaming && monthlyUsd != null && monthlyUsd > 0 && monthlyUsd < 5 && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <b>Torneira simbólica.</b> O stream está em {usd(monthlyUsd)}/mês — o encanamento funciona, mas isso não paga ninguém de
              verdade. Os pesos e as barras abaixo mostram como o dinheiro <em>seria</em> dividido. Pra valer, suba a vazão em
              Controles → stream.
            </p>
          )}

          {flow}

          {/* At-a-glance numbers, in plain words */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Pagando" value={monthlyUsd != null ? usd(monthlyUsd) : "—"} sub="/mês" tone={streaming ? "text-foreground" : "text-foreground-muted"} />
            <Stat
              label="Reserva dura"
              hint="Quanto tempo o pagamento continua com a reserva atual, sem repor nada."
              value={runwayDays == null ? "∞" : `${Math.floor(runwayDays)}`}
              sub={runwayDays == null ? undefined : " dias"}
              tone={runwayDays != null && runwayDays < 14 ? "text-danger" : runwayDays != null && runwayDays < 45 ? "text-warning" : "text-success"}
            />
            <Stat label="Na reserva" hint="O dinheiro já convertido, pronto pra pingar no time." value={usd(bufferUsd)} />
            <Stat label="Recebendo ao vivo" value={`${connectedCount}`} sub={`/${activeCount}`} tone={connectedCount === activeCount && activeCount > 0 ? "text-success" : "text-warning"} />
          </div>

          {sustainability}
          <WhoGetsWhat members={members} monthlyUsd={monthlyUsd} connectSlot={connect} />
        </div>
      ) : (
        <div className="space-y-5">
          <p className="rounded-xl border border-border bg-surface-elevated p-3 text-xs text-foreground-muted">
            Cada ação vira uma proposta na carteira multisig — os signatários aprovam antes de executar. Siga os passos na ordem.
          </p>
          {steps.map((s, i) => (
            <section key={s.title} className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-bg font-mono text-xs font-bold text-accent">
                  {i + 1}
                </span>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {i === 0 && <Wallet className="h-3.5 w-3.5 text-foreground-faint" />}
                  {s.title}
                </h3>
              </div>
              <div className="pl-0 sm:pl-9">{s.node}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
