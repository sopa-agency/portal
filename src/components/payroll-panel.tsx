"use client";

import { useState, useTransition } from "react";
import { Users2, Plus, Pencil, Trash2, Check, X, Loader2, ExternalLink } from "lucide-react";
import {
  createPayrollMember,
  updatePayrollMember,
  deletePayrollMember,
  type PayrollMemberDTO,
} from "@/app/actions/payroll";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;

/** A team-roster member the payroll form can pre-fill from (address auto-detected). */
export type PayrollRosterOption = { username: string; avatarUrl: string; address?: string };

type Draft = { label: string; address: string; units: string };
const emptyDraft = (): Draft => ({ label: "", address: "", units: "" });

function MemberForm({
  initial,
  busy,
  roster,
  onSave,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  /** When set, a "pick from team" selector pre-fills name + wallet. */
  roster?: PayrollRosterOption[];
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  return (
    <div className="space-y-2 rounded-lg border border-accent-border bg-accent-bg/40 p-2.5">
      {roster && roster.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const r = roster.find((x) => x.username === e.target.value);
            if (r) setD((prev) => ({ ...prev, label: r.username, address: r.address ?? prev.address }));
          }}
          className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        >
          <option value="">— escolher do time —</option>
          {roster.map((r) => (
            <option key={r.username} value={r.username}>
              @{r.username}{r.address ? " · carteira ✓" : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          value={d.label}
          onChange={(e) => setD({ ...d, label: e.target.value })}
          placeholder="Nome / handle"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
        <input
          value={d.units}
          onChange={(e) => setD({ ...d, units: e.target.value })}
          inputMode="numeric"
          placeholder="peso (units)"
          className="w-28 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs tabular-nums text-foreground focus:border-border-strong focus:outline-none"
        />
      </div>
      <input
        value={d.address}
        onChange={(e) => setD({ ...d, address: e.target.value })}
        placeholder="0x… carteira EVM (Base)"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-border-strong focus:outline-none"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
        <button
          type="button"
          onClick={() => onSave(d)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar
        </button>
      </div>
    </div>
  );
}

// SOPA payroll stream registry: the members + wallets + weights (units) behind
// the Superfluid distribution pool. The portal stores/plans it; the actual pool
// is configured in the Safe. Shares are computed live from active units.
export function PayrollPanel({
  initial,
  canEdit,
  roster = [],
}: {
  initial: PayrollMemberDTO[];
  canEdit: boolean;
  roster?: PayrollRosterOption[];
}) {
  const [members, setMembers] = useState<PayrollMemberDTO[]>(initial);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Roster members not already on payroll (matched by username or wallet).
  const available = roster.filter(
    (r) =>
      !members.some(
        (m) =>
          m.label.toLowerCase() === r.username.toLowerCase() ||
          (r.address && m.address.toLowerCase() === r.address.toLowerCase()),
      ),
  );

  const totalUnits = members.filter((m) => m.active).reduce((s, m) => s + m.units, 0);
  const share = (m: PayrollMemberDTO) => (m.active && totalUnits > 0 ? (m.units / totalUnits) * 100 : 0);

  const doCreate = (d: Draft) =>
    start(async () => {
      setErr(null);
      const res = await createPayrollMember({ label: d.label, address: d.address, units: Number(d.units || 0) });
      if (res.ok) {
        setMembers((prev) => [...prev, res.member]);
        setAdding(false);
      } else setErr(res.error);
    });

  const doUpdate = (id: string, patch: Parameters<typeof updatePayrollMember>[1]) =>
    start(async () => {
      setErr(null);
      const res = await updatePayrollMember(id, patch);
      if (res.ok) {
        setMembers((prev) => prev.map((m) => (m.id === id ? res.member : m)));
        setEditId(null);
      } else setErr(res.error);
    });

  const doDelete = (id: string) =>
    start(async () => {
      setErr(null);
      const res = await deletePayrollMember(id);
      if (res.ok) setMembers((prev) => prev.filter((m) => m.id !== id));
      else setErr(res.error);
    });

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Users2 className="h-4 w-4 text-accent" /> Stream do time
        </h2>
        {canEdit && !adding && editId === null && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar membro
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-foreground-subtle">
        Membros, carteiras e pesos (units) da pool de distribuição. Os pesos definem a fatia de cada um —
        share = units ÷ total de units ativas. Configure a pool no Safe/Superfluid com estes valores.
      </p>

      {err && <p className="mb-2 text-[11px] text-danger">{err}</p>}

      {adding && (
        <div className="mb-3">
          <MemberForm initial={emptyDraft()} busy={pending} roster={available} onSave={doCreate} onCancel={() => setAdding(false)} />
        </div>
      )}

      {members.length === 0 && !adding ? (
        <p className="py-6 text-center text-xs text-foreground-faint">
          Nenhum membro ainda.{canEdit ? " Adicione o primeiro (você mesmo, com 100 units, pra testar)." : ""}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) =>
            editId === m.id ? (
              <li key={m.id}>
                <MemberForm
                  initial={{ label: m.label, address: m.address, units: String(m.units) }}
                  busy={pending}
                  onSave={(d) => doUpdate(m.id, { label: d.label, address: d.address, units: Number(d.units || 0) })}
                  onCancel={() => setEditId(null)}
                />
              </li>
            ) : (
              <li
                key={m.id}
                className={`group flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2 ${m.active ? "" : "opacity-55"}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{m.label}</span>
                    {!m.active && <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-foreground-muted">inativo</span>}
                  </div>
                  <a
                    href={`https://basescan.org/address/${m.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-foreground-faint hover:text-accent"
                    title={m.address}
                  >
                    {shortAddr(m.address)} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">{pct(share(m))}</p>
                  <p className="font-mono text-[10px] text-foreground-faint">{m.units}u</p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => doUpdate(m.id, { active: !m.active })}
                      title={m.active ? "Desativar" : "Ativar"}
                      className="rounded-md p-1 text-foreground-faint hover:text-foreground"
                    >
                      {m.active ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(m.id)}
                      aria-label="Editar"
                      className="rounded-md p-1 text-foreground-faint hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => doDelete(m.id)}
                      aria-label="Remover"
                      className="rounded-md p-1 text-foreground-faint hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {totalUnits > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
          <span className="text-foreground-muted">{members.filter((m) => m.active).length} ativos</span>
          <span className="font-mono tabular-nums text-foreground-muted">Σ {totalUnits} units = 100%</span>
        </div>
      )}
    </section>
  );
}
