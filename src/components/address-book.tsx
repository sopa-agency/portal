"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, ExternalLink, BadgeCheck, TriangleAlert, Globe, Plus, Trash2 } from "lucide-react";
import { suggestAddressEns, addManualAddress, removeManualAddress } from "@/app/actions/sopa-boards";
import type { AddressBookEntry } from "@/lib/address-book";
import type { BridgeFeeSummary } from "@/lib/bridge-fee-inflows";

const isAddr = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a.trim());
const eth = (n: number) => {
  const s = n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return s === "0" || s === "" ? "0" : s;
};

function BridgeFeePanel({ s }: { s: BridgeFeeSummary }) {
  const b = s.breakdown;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Bridge fee — LI.FI · 0,5%</h4>
        <span className="text-[11px] text-foreground-faint">até {s.asOf}</span>
      </div>
      <div className="flex flex-wrap gap-5">
        <div>
          <div className="text-lg font-bold tabular-nums text-foreground">{eth(b.totalGross)} ETH</div>
          <div className="text-[11px] text-foreground-subtle">coletado (total)</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums text-success">{eth(b.externalClientGross)} ETH</div>
          <div className="text-[11px] text-foreground-subtle">cliente externo ({b.counts.external})</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums text-foreground-muted">{eth(b.internalTestGross)} ETH</div>
          <div className="text-[11px] text-foreground-subtle">interno/teste ({b.counts.internal})</div>
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        Receita de <b className="text-foreground">cliente</b> só sobe quando gente de fora usa o widget. Até {s.asOf}, 100% é
        tesouro/testes nossos — não inflar como cliente. Fee 50&nbsp;bps confirmada on-chain (0,6575 × 0,005 ≈ coletado).
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-foreground-subtle">entradas ({s.inflows.length})</summary>
        <div className="mt-1 space-y-0.5">
          {s.inflows.map((i) => (
            <div key={i.txHash} className="text-foreground-muted">
              <span className="tabular-nums">{eth(i.eth)} ETH</span> · {i.note} ·{" "}
              <span className="text-foreground-faint">{i.ts.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      </details>
      <p className="text-[10px] text-foreground-faint">Snapshot manual — atualiza quando plugarmos um indexer da Base.</p>
    </div>
  );
}

const EXPLORER: Record<string, string> = {
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
  optimism: "https://optimistic.etherscan.io",
  arbitrum: "https://arbiscan.io",
};
const CHAIN_ID: Record<string, number> = { base: 8453, ethereum: 1, optimism: 10, arbitrum: 42161 };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// 0xSplits contracts get the Splits app (recipients + distributions), not a raw
// block explorer — that's where a split actually reads as a split. Everything
// else (wallets, plain contracts) goes to the chain's explorer.
const linkFor = (entry: { chains: string[]; kinds: string[]; address: string }) => {
  const chain = entry.chains[0] ?? "base";
  if (entry.kinds.includes("split")) {
    return {
      url: `https://app.splits.org/accounts/${entry.address}/?chainId=${CHAIN_ID[chain] ?? 8453}`,
      label: "Ver no Splits",
    };
  }
  return { url: `${EXPLORER[chain] ?? EXPLORER.base}/address/${entry.address}`, label: "Ver no explorer" };
};

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copiar endereço"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="text-foreground-faint transition hover:text-foreground"
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function EnsCell({ entry }: { entry: AddressBookEntry }) {
  if (!entry.ens) return <span className="text-foreground-faint">—</span>;
  const tone =
    entry.ensSource === "reverse"
      ? { cls: "text-success", Icon: Globe, note: "ENS on-chain" }
      : entry.verified
        ? { cls: "text-success", Icon: BadgeCheck, note: "sugerido · verificado" }
        : { cls: "text-warning", Icon: TriangleAlert, note: "sugerido · não verificado" };
  const { cls, Icon, note } = tone;
  return (
    <span className="inline-flex items-center gap-1.5" title={note}>
      <span className="font-medium text-foreground">{entry.ens}</span>
      <Icon className={`h-3.5 w-3.5 ${cls}`} />
    </span>
  );
}

function AddressRow({ entry }: { entry: AddressBookEntry }) {
  const [row, setRow] = useState(entry);
  // Pre-fill with the current name so it's editable in place (subENS included).
  const [draft, setDraft] = useState(entry.ens ?? "");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const link = linkFor(row);
  const router = useRouter();
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      await removeManualAddress(row.address);
      router.refresh();
    });

  const submit = () => {
    const ens = draft.trim();
    setMsg(null);
    start(async () => {
      const res = await suggestAddressEns(row.address, ens);
      if ("error" in res) {
        setMsg({ text: res.error, ok: false });
        return;
      }
      setRow((r) => ({
        ...r,
        ens: res.ens || null,
        ensSource: res.ens ? "suggested" : null,
        verified: res.verified,
      }));
      setDraft(res.ens);
      // Distinguish resolves-here / exists-but-elsewhere / doesn't-exist.
      if (!res.ens) setMsg(null);
      else if (res.verified) setMsg({ text: "✓ resolve pra este endereço", ok: true });
      else if (res.resolvedTo)
        setMsg({ text: `⚠ existe, mas aponta pra ${short(res.resolvedTo)} — não é este`, ok: false });
      else setMsg({ text: "⚠ não existe / não resolve on-chain", ok: false });
    });
  };

  return (
    <tr className="border-t border-border align-top">
      <td className="py-2.5 px-3">
        <EnsCell entry={row} />
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-1.5">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-foreground-muted transition hover:text-accent"
          >
            {short(row.address)}
          </a>
          <CopyBtn value={row.address} />
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={link.label}
            className="text-foreground-faint transition hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap gap-1">
          {row.deployedOn.length > 0
            ? row.deployedOn.map((c) => (
                <span
                  key={c}
                  title="contrato detectado nesta EVM"
                  className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success"
                >
                  {c}
                </span>
              ))
            : row.chains.map((c) => (
                <span key={c} className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle">
                  {c}
                </span>
              ))}
          {row.kinds
            .filter((k) => k !== "manual")
            .map((k) => (
              <span key={k} className="rounded bg-accent-bg px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {k}
              </span>
            ))}
          {row.manual && (
            <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-faint">manual</span>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-col gap-0.5">
          {row.refs.slice(0, 3).map((r, i) => (
            <span key={i} className="text-xs text-foreground-muted">
              <span className="text-foreground-subtle">{r.project}</span> · {r.label}
            </span>
          ))}
          {row.refs.length > 3 && (
            <span className="text-[10px] text-foreground-faint">+{row.refs.length - 3} mais</span>
          )}
          {row.refs.length === 0 && (
            <span className="text-xs text-foreground-faint">{row.label || "adicionado à mão"}</span>
          )}
        </div>
      </td>
      <td className="py-2.5">
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && draft.trim() && submit()}
            placeholder={row.ens ? "editar nome…" : "sugerir ENS (nome.eth ou sub.nome.eth)"}
            className="w-36 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-accent-bg px-2 py-1 text-xs font-semibold text-accent transition hover:brightness-95 disabled:opacity-40"
          >
            {pending ? "…" : "salvar"}
          </button>
          {row.manual && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              title="Remover contrato manual"
              className="text-foreground-faint transition hover:text-danger disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {msg && <p className={`mt-1 text-[10px] ${msg.ok ? "text-success" : "text-warning"}`}>{msg.text}</p>}
      </td>
    </tr>
  );
}

function AddContractForm() {
  const router = useRouter();
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      setMsg(null);
      const r = await addManualAddress(addr.trim(), label.trim() || undefined);
      if (!r.ok) return setMsg(r.error);
      setAddr("");
      setLabel("");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
      <Plus className="h-4 w-4 text-foreground-faint" />
      <input
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        placeholder="0x… endereço do contrato"
        className="w-64 rounded-md border border-border bg-surface-elevated px-2 py-1 font-mono text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="rótulo (opcional)"
        className="w-40 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
      />
      <button
        type="button"
        onClick={add}
        disabled={pending || !isAddr(addr)}
        className="rounded-md bg-accent-bg px-3 py-1 text-xs font-semibold text-accent transition hover:brightness-95 disabled:opacity-40"
      >
        {pending ? "…" : "adicionar contrato"}
      </button>
      {msg && <span className="text-[11px] text-warning">{msg}</span>}
    </div>
  );
}

export function AddressBook({
  entries,
  bridgeFee,
}: {
  entries: AddressBookEntry[];
  bridgeFee?: BridgeFeeSummary;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground-muted">
        Todos os endereços on-chain que a org rastreia. As <span className="text-success">EVMs em verde</span> são onde o
        contrato foi detectado (bytecode nas 8 principais). O ENS resolve sozinho (registro reverso); você pode{" "}
        <span className="text-foreground">sugerir/editar</span> um nome (a gente verifica se ele aponta de volta) e{" "}
        <span className="text-foreground">adicionar contratos</span> à mão.
      </p>
      {bridgeFee && <BridgeFeePanel s={bridgeFee} />}
      <AddContractForm />
      {!entries.length ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-foreground-muted">
          Nenhum endereço ainda. Adicione um contrato acima, ou crie revenue streams com endereço nos cards do org-chart.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-foreground-faint">
              <th className="px-3 py-2 font-semibold">ENS / nome</th>
              <th className="px-3 py-2 font-semibold">Endereço</th>
              <th className="px-3 py-2 font-semibold">Chain · tipo</th>
              <th className="px-3 py-2 font-semibold">Usado em</th>
              <th className="px-3 py-2 font-semibold">Sugerir ENS</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <AddressRow key={e.address} entry={e} />
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
