"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Loader2, Trash2, CalendarPlus, Check, ArrowUpRight, Wallet, X } from "lucide-react";
import { createBounty, cancelBounty, proposeBountyPayment, markBountyPaid, getSafeOptions, type BountyDTO, type SafeTokenAvailability, type SafeChainOption } from "@/app/actions/bounty";
import { CopyButton } from "@/components/copy-button";

const CHAIN_LABEL: Record<number, string> = { 8453: "Base", 1: "Ethereum" };

/** Stable handle for a task across reloads: GitHub node id, then url, then item id. */
export function taskKeyOf(it: { contentId?: string | null; url?: string; id: string }): string {
  return it.contentId ?? it.url ?? it.id;
}

/** Trim a number to a readable amount of significant decimals. */
function fmtNum(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function tokenGlyph(symbol: string) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold uppercase tracking-tight text-amber-600 dark:text-amber-400">
      {symbol.slice(0, 3)}
    </span>
  );
}

export function BountyBadge({ bounty }: { bounty: BountyDTO }) {
  const tone =
    bounty.status === "paid"
      ? "border-success/40 bg-success/10 text-success"
      : bounty.status === "proposed"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={`flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}>
      <Coins className="h-2.5 w-2.5 shrink-0" /> {fmtNum(bounty.amount)} {bounty.tokenSymbol}
    </span>
  );
}

/** Deep-link to the meeting editor, pre-filled as an EXEC meeting for a task. */
export function ExecMeetingButton({
  projectSlug,
  title,
  body,
  logins,
  className,
}: {
  projectSlug: string;
  title: string;
  body?: string | null;
  logins: string[];
  className?: string;
}) {
  const router = useRouter();
  function go() {
    const prefill = { title, forProject: projectSlug, kind: "exec" as const, notes: body ?? "", logins };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(prefill))));
    router.push(`/reunioes?new=${encodeURIComponent(b64)}`);
  }
  return (
    <button type="button" onClick={go} className={className ?? "flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"}>
      <CalendarPlus className="h-4 w-4" /> Criar reunião EXEC
    </button>
  );
}

/**
 * Bounty lifecycle for one task, paid from the project's Safe. Global admins can
 * reserve a bounty (in a token the Safe holds, capped at its balance), set the
 * payee, propose the Safe payment, mark paid, or cancel. Non-admins see read-only
 * status. Renders nothing when there's no bounty and the viewer can't manage.
 */
export function BountyPanel({
  projectSlug,
  taskKey,
  title,
  bounty,
  canManage,
  onChanged,
}: {
  projectSlug: string;
  taskKey: string;
  title: string;
  bounty: BountyDTO | undefined;
  canManage: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState(bounty?.payeeAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Create form is collapsed behind a button (like "Criar reunião EXEC").
  const [expanded, setExpanded] = useState(false);
  // Chains the Safe can pay from (Base/Ethereum) + their spendable tokens.
  const showCreate = !bounty && canManage;
  const [chains, setChains] = useState<SafeChainOption[] | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [tokenKey, setTokenKey] = useState<string>("eth");
  useEffect(() => {
    if (!showCreate || !expanded) return;
    let live = true;
    getSafeOptions(projectSlug).then((r) => {
      if (!live) return;
      const list = r.ok ? r.chains : [];
      setChains(list);
      if (list[0]) {
        setChainId(list[0].chainId);
        const t0 = list[0].tokens[0];
        setTokenKey(t0 ? (t0.address ? t0.address.toLowerCase() : "eth") : "eth");
      }
    });
    return () => { live = false; };
  }, [showCreate, expanded, projectSlug]);
  const keyOf = (t: SafeTokenAvailability) => (t.address ? t.address.toLowerCase() : "eth");
  const activeChain = chains?.find((c) => c.chainId === chainId) ?? null;
  const tokens = activeChain?.tokens ?? [];
  const selected = tokens.find((t) => keyOf(t) === tokenKey) ?? null;
  const overCap = !!selected && Number(amount) > Number(selected.available) + 1e-12;

  if (!bounty && !canManage) return null;

  // Collapsed: just a button (sibling to "Criar reunião EXEC") that reveals the form.
  if (showCreate && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
      >
        <Coins className="h-4 w-4" /> Transformar em bounty
      </button>
    );
  }

  async function refresh() {
    if (onChanged) await onChanged();
    else router.refresh();
  }
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: okText }); await refresh(); }
    else setMsg({ ok: false, text: r.error ?? "Falha." });
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.07] to-transparent">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-amber-500/15 px-3.5 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Coins className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-none text-foreground">Bounty</p>
          <p className="mt-0.5 text-[11px] leading-none text-foreground-faint">pago do Safe do projeto</p>
        </div>
        {bounty && (
          <span className="ml-auto"><BountyBadge bounty={bounty} /></span>
        )}
        {showCreate && (
          <button type="button" onClick={() => setExpanded(false)} aria-label="Fechar" className="ml-auto shrink-0 text-foreground-faint hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-3 p-3.5">
        {msg && (
          <p className={`rounded-lg px-2.5 py-1.5 text-xs ${msg.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{msg.text}</p>
        )}

        {/* ── Create ── */}
        {showCreate && (
          chains === null ? (
            <p className="flex items-center gap-1.5 py-2 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo redes e saldos do Safe…</p>
          ) : chains.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nenhuma rede pronta. Configure o Safe e registre o proposer como delegate (Base e/ou Ethereum) em Settings → Bounties.</p>
          ) : (
            <div className="space-y-3">
              {/* Chain picker (only when usable on >1 chain) */}
              {chains.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">Rede</p>
                  <div className="flex gap-1.5">
                    {chains.map((c) => {
                      const on = c.chainId === chainId;
                      return (
                        <button
                          key={c.chainId}
                          type="button"
                          onClick={() => { setChainId(c.chainId); const t0 = c.tokens[0]; setTokenKey(t0 ? (t0.address ? t0.address.toLowerCase() : "eth") : "eth"); setAmount(""); setMsg(null); }}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${on ? "border-accent bg-accent-bg text-accent" : "border-border bg-surface text-foreground-muted hover:border-border-strong"}`}
                        >
                          {CHAIN_LABEL[c.chainId] ?? c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {tokens.length === 0 && <p className="text-xs text-foreground-muted">Sem saldo confiável nessa rede.</p>}
              {/* Token picker */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">Token</p>
                <div className="flex flex-wrap gap-1.5">
                  {tokens.map((t) => {
                    const k = keyOf(t);
                    const on = k === tokenKey;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setTokenKey(k); setAmount(""); setMsg(null); }}
                        className={`group flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all ${on ? "border-accent bg-accent-bg shadow-sm" : "border-border bg-surface hover:border-border-strong"}`}
                      >
                        {tokenGlyph(t.symbol)}
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
                            {t.symbol}
                            {on && <Check className="h-3 w-3 text-accent" />}
                          </span>
                          <span className="block text-[10px] tabular-nums text-foreground-faint">{fmtNum(t.available)} livre</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">Valor</p>
                  {selected && (
                    <span className="text-[10px] tabular-nums text-foreground-faint">
                      disponível <span className="font-semibold text-foreground-muted">{fmtNum(selected.available)} {selected.symbol}</span>
                    </span>
                  )}
                </div>
                <div className={`flex items-center rounded-lg border bg-surface pr-1.5 transition-colors ${overCap ? "border-danger" : "border-border focus-within:border-border-strong"}`}>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                    className="w-full bg-transparent px-2.5 py-2 text-base font-semibold tabular-nums text-foreground placeholder:text-foreground-faint focus:outline-none"
                  />
                  {selected && <span className="shrink-0 text-xs font-medium text-foreground-muted">{selected.symbol}</span>}
                  <button
                    type="button"
                    onClick={() => selected && setAmount(selected.available)}
                    className="ml-1.5 shrink-0 rounded-md bg-accent-bg px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
                  >
                    Máx
                  </button>
                </div>
                {overCap && <p className="text-[11px] text-danger">Acima do disponível no Safe.</p>}
              </div>

              <button
                type="button"
                onClick={() => run(() => createBounty({ projectSlug, taskKey, title, chainId: chainId!, tokenAddress: selected?.address ?? null, amount }), "Bounty criado ✅")}
                disabled={busy || !amount.trim() || overCap || !selected || !chainId}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Transformar em bounty
              </button>
            </div>
          )
        )}

        {/* ── Open: reserved, awaiting payout ── */}
        {bounty && bounty.status === "open" && (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-foreground">{fmtNum(bounty.amount)}</span>
              <span className="text-sm font-medium text-foreground-muted">{bounty.tokenSymbol}</span>
              <span className="text-[11px] text-foreground-faint">· {CHAIN_LABEL[bounty.chainId] ?? bounty.chainId}</span>
              <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">reservado</span>
            </div>
            {canManage ? (
              <>
                <div className="space-y-1">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-faint"><Wallet className="h-3 w-3" /> Carteira do beneficiário</p>
                  <input
                    value={payee}
                    onChange={(e) => setPayee(e.target.value)}
                    placeholder="0x… (quem entregou)"
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 font-mono text-xs text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => run(() => proposeBountyPayment(bounty.id, payee), "Pagamento proposto no Safe ✅ — aguarda aprovação dos owners.")}
                    disabled={busy || !payee.trim()}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />} Propor pagamento
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => cancelBounty(bounty.id), "Bounty cancelado.")}
                    disabled={busy}
                    title="Cancelar bounty"
                    className="shrink-0 rounded-lg border border-border p-2.5 text-foreground-faint transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-foreground-muted">Ao concluir, um admin propõe o pagamento no Safe do projeto.</p>
            )}
          </div>
        )}

        {/* ── Proposed: in the Safe queue ── */}
        {bounty && bounty.status === "proposed" && (
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-foreground">{fmtNum(bounty.amount)}</span>
              <span className="text-sm font-medium text-foreground-muted">{bounty.tokenSymbol}</span>
              <span className="text-[11px] text-foreground-faint">· {CHAIN_LABEL[bounty.chainId] ?? bounty.chainId}</span>
              <span className="ml-auto flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning"><Loader2 className="h-2.5 w-2.5 animate-spin" /> aguardando owners</span>
            </div>
            {bounty.payeeAddress && (
              <CopyButton value={bounty.payeeAddress} title="Copiar carteira" className="flex w-full items-center gap-1 truncate font-mono text-[11px] text-foreground-muted hover:text-foreground">
                <Wallet className="h-3 w-3 shrink-0" /> {bounty.payeeAddress}
              </CopyButton>
            )}
            {bounty.safeTxHash && (
              <CopyButton value={bounty.safeTxHash} title="Copiar safeTxHash" className="flex w-full items-center gap-1 truncate font-mono text-[10px] text-foreground-faint hover:text-foreground-muted">
                {bounty.safeTxHash}
              </CopyButton>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => run(() => markBountyPaid(bounty.id), "Marcado como pago ✅")}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Marcar como pago
              </button>
            )}
          </div>
        )}

        {/* ── Paid ── */}
        {bounty && bounty.status === "paid" && (
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-success"><Check className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-semibold text-foreground">{fmtNum(bounty.amount)} {bounty.tokenSymbol} pago</p>
              {bounty.payeeAddress && <p className="font-mono text-[11px] text-foreground-faint">→ {bounty.payeeAddress}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
