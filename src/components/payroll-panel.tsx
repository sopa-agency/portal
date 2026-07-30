"use client";

import { useState, useTransition } from "react";
import { Users2, Plus, Pencil, Trash2, Check, X, Loader2, ExternalLink, SlidersHorizontal, Scale } from "lucide-react";
import {
  createPayrollMember,
  updatePayrollMember,
  deletePayrollMember,
  setPayrollWeights,
  type PayrollMemberDTO,
} from "@/app/actions/payroll";
import { useConfirm } from "@/components/confirm-dialog";
import { pct } from "@/lib/format";
import { chartColorAt as colorAt } from "@/lib/chart-colors";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A team-roster member the payroll form can pre-fill from (address auto-detected). */
export type PayrollRosterOption = { username: string; avatarUrl: string; address?: string };

type Draft = { label: string; address: string; units: string };
const emptyDraft = (): Draft => ({ label: "", address: "", units: "" });

// ---------------------------------------------------------------------------
// Stacked allocation bar — the split at a glance
// ---------------------------------------------------------------------------
function AllocationBar({ slices }: { slices: { label: string; share: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.share, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-border">
        {slices.map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.share / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label} · ${pct((s.share / total) * 100)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="font-medium text-foreground">{s.label}</span>
            <span className="tabular-nums text-foreground-faint">{pct((s.share / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual weight divider — sliders that rebalance live
// ---------------------------------------------------------------------------
function WeightsEditor({
  members,
  busy,
  onSave,
  onCancel,
}: {
  members: PayrollMemberDTO[]; // active only
  busy: boolean;
  onSave: (weights: { id: string; units: number }[]) => void;
  onCancel: () => void;
}) {
  // Enter with the current split expressed as 0–100 weights (so sliders read as %).
  const [w, setW] = useState<Record<string, number>>(() => {
    const total = members.reduce((s, m) => s + m.units, 0);
    const out: Record<string, number> = {};
    members.forEach((m, i) => {
      out[m.id] = total > 0 ? Math.round((m.units / total) * 100) : Math.round(100 / members.length) + (i === 0 ? 100 % members.length : 0);
    });
    return out;
  });

  const sum = members.reduce((s, m) => s + (w[m.id] ?? 0), 0);
  const share = (id: string) => (sum > 0 ? ((w[id] ?? 0) / sum) * 100 : 0);
  const equalize = () => {
    const base = Math.floor(100 / members.length);
    const next: Record<string, number> = {};
    members.forEach((m, i) => (next[m.id] = base + (i === 0 ? 100 - base * members.length : 0)));
    setW(next);
  };

  return (
    <div className="space-y-4 rounded-xl border border-accent-border bg-accent-bg/30 p-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-accent" /> Dividir pesos
        </h4>
        <button
          type="button"
          onClick={equalize}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
        >
          <Scale className="h-3.5 w-3.5" /> Igualar
        </button>
      </div>

      <AllocationBar slices={members.map((m, i) => ({ label: m.label, share: w[m.id] ?? 0, color: colorAt(i) }))} />

      <div className="space-y-3">
        {members.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorAt(i) }} aria-hidden />
            <span className="w-28 shrink-0 truncate text-sm font-medium text-foreground">{m.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={w[m.id] ?? 0}
              onChange={(e) => setW((prev) => ({ ...prev, [m.id]: Number(e.target.value) }))}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent"
              aria-label={`Peso de ${m.label}`}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={w[m.id] ?? 0}
              onChange={(e) => setW((prev) => ({ ...prev, [m.id]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
              className="w-14 shrink-0 rounded-md border border-border bg-surface-elevated px-1.5 py-1 text-right text-xs tabular-nums text-foreground focus:border-border-strong focus:outline-none"
            />
            <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-accent">{pct(share(m.id))}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="font-mono text-[11px] text-foreground-faint">Σ {sum} units → fatias somam 100%</span>
        <div className="flex gap-1.5">
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
            onClick={() => onSave(members.map((m) => ({ id: m.id, units: w[m.id] ?? 0 })))}
            disabled={busy || sum === 0}
            className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar pesos
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a single member
// ---------------------------------------------------------------------------
function MemberForm({
  initial,
  busy,
  roster,
  onSave,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  roster?: PayrollRosterOption[];
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  return (
    <div className="space-y-2 rounded-lg border border-accent-border bg-accent-bg/40 p-2.5">
      {roster && roster.length > 0 && (
        <select
          aria-label="Escolher um membro já cadastrado no time"
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
          aria-label="Nome ou handle do membro"
          placeholder="Nome / handle"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
        <input
          value={d.units}
          onChange={(e) => setD({ ...d, units: e.target.value })}
          inputMode="numeric"
          aria-label="Peso do membro (units)"
          placeholder="peso (units)"
          className="w-28 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs tabular-nums text-foreground focus:border-border-strong focus:outline-none"
        />
      </div>
      <input
        value={d.address}
        onChange={(e) => setD({ ...d, address: e.target.value })}
        aria-label="Carteira EVM do membro (Base)"
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

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
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
  const [dividing, setDividing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmUI } = useConfirm();

  const activeMembers = members.filter((m) => m.active);
  const totalUnits = activeMembers.reduce((s, m) => s + m.units, 0);
  const share = (m: PayrollMemberDTO) => (m.active && totalUnits > 0 ? (m.units / totalUnits) * 100 : 0);
  const idle = !adding && editId === null && !dividing;

  const available = roster.filter(
    (r) =>
      !members.some(
        (m) => m.label.toLowerCase() === r.username.toLowerCase() || (r.address && m.address.toLowerCase() === r.address.toLowerCase()),
      ),
  );

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

  const doDelete = async (id: string) => {
    const m = members.find((x) => x.id === id);
    const okToDelete = await confirm({
      title: "Remover membro?",
      message: m
        ? `${m.label} sai do payroll. As units dele voltam pro bolo e as fatias se redistribuem.`
        : "O membro sai do payroll e as fatias se redistribuem.",
      confirmLabel: "Remover",
    });
    if (!okToDelete) return;
    start(async () => {
      setErr(null);
      const res = await deletePayrollMember(id);
      if (res.ok) setMembers((prev) => prev.filter((x) => x.id !== id));
      else setErr(res.error);
    });
  };

  const doWeights = (weights: { id: string; units: number }[]) =>
    start(async () => {
      setErr(null);
      const res = await setPayrollWeights(weights);
      if (res.ok) {
        setMembers(res.members);
        setDividing(false);
      } else setErr(res.error);
    });

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Users2 className="h-4 w-4 text-accent" /> O time e as fatias
        </h2>
        {canEdit && idle && (
          <div className="flex gap-1.5">
            {activeMembers.length >= 2 && (
              <button
                type="button"
                onClick={() => setDividing(true)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Dividir pesos
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar membro
            </button>
          </div>
        )}
      </div>
      <p className="mb-3 text-xs text-foreground-subtle">
        Quem recebe, a carteira e o peso de cada um. A fatia é o peso dividido pelo total — arraste em “Dividir pesos” e os valores por mês se ajustam sozinhos.
      </p>

      {err && <p className="mb-2 text-[11px] text-danger">{err}</p>}

      {/* Live split at a glance (read mode) */}
      {idle && totalUnits > 0 && (
        <div className="mb-4">
          <AllocationBar slices={activeMembers.map((m, i) => ({ label: m.label, share: m.units, color: colorAt(i) }))} />
        </div>
      )}

      {dividing && (
        <div className="mb-3">
          <WeightsEditor members={activeMembers} busy={pending} onSave={doWeights} onCancel={() => setDividing(false)} />
        </div>
      )}

      {adding && (
        <div className="mb-3">
          <MemberForm initial={emptyDraft()} busy={pending} roster={available} onSave={doCreate} onCancel={() => setAdding(false)} />
        </div>
      )}

      {members.length === 0 && idle ? (
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
                {canEdit && idle && (
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

      {idle && totalUnits > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
          <span className="text-foreground-muted">{activeMembers.length} ativos</span>
          <span className="font-mono tabular-nums text-foreground-muted">Σ {totalUnits} units = 100%</span>
        </div>
      )}
      {confirmUI}
    </section>
  );
}
