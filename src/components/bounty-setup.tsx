"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Copy, ChevronDown, ExternalLink } from "lucide-react";

const safeAppUrl = (chainId: number, address: string) => `https://app.safe.global/home?safe=${chainId === 1 ? "eth" : "base"}:${address}`;
import { getBountySetup, saveBountyConfig, type ProjectBounty, type ChainStatus } from "@/app/actions/bounty";

export function BountySetup() {
  const [proposer, setProposer] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectBounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await getBountySetup();
    setLoading(false);
    if (r.ok) { setProposer(r.proposer); setProjects(r.projects); }
    else setErr(r.error);
  }
  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-sm text-foreground-muted"><Loader2 className="inline h-4 w-4 animate-spin" /> Carregando bounty setup…</p>;

  return (
    <section aria-labelledby="bounty-heading" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 id="bounty-heading" className="text-lg font-semibold tracking-tight text-foreground">Bounties &amp; Safe</h2>
        <span className="text-xs text-foreground-faint">cada Safe paga em Base e Ethereum — token escolhido por bounty</span>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Proposer (delegate de cada Safe — só propõe)</div>
        {proposer ? (
          <button type="button" onClick={() => navigator.clipboard?.writeText(proposer)} title="Copiar" className="mt-1 flex w-full items-center gap-1.5 truncate font-mono text-xs text-accent hover:underline">
            <Copy className="h-3 w-3 shrink-0" /> {proposer}
          </button>
        ) : (
          <p className="mt-1 text-xs text-danger">SAFE_PROPOSER_PRIVATE_KEY não configurado.</p>
        )}
        <p className="mt-1.5 text-[11px] text-foreground-faint">Registre esse endereço como delegate de cada Safe no app.safe.global — em <span className="font-medium">cada rede</span> que for usar.</p>
      </div>

      <div className="space-y-2">
        {projects.map((p) => (
          <ProjectBountyRow
            key={p.slug}
            project={p}
            isOpen={open === p.slug}
            onToggle={() => setOpen(open === p.slug ? null : p.slug)}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  );
}

function ChainPill({ c }: { c: ChainStatus }) {
  if (!c.exists) return <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-faint">{c.name}: —</span>;
  const ok = c.delegate === true;
  return (
    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${ok ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {c.name}
    </span>
  );
}

function ProjectBountyRow({
  project,
  isOpen,
  onToggle,
  onChanged,
}: {
  project: ProjectBounty;
  isOpen: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const [addr, setAddr] = useState(project.safeAddress ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true); setMsg(null);
    const r = await saveBountyConfig(project.slug, { safeAddress: addr });
    setSaving(false);
    if (r.ok) { setMsg({ ok: true, text: "Salvo ✅" }); await onChanged(); }
    else setMsg({ ok: false, text: r.error });
  }

  const readyChains = project.chains.filter((c) => c.exists && c.delegate === true).length;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-elevated">
        <span className="text-sm font-semibold text-foreground">{project.name}</span>
        <span className="flex items-center gap-1.5">
          {project.safeAddress ? (
            project.chains.length ? project.chains.map((c) => <ChainPill key={c.chainId} c={c} />) : <span className="text-[10px] text-foreground-faint">checando…</span>
          ) : (
            <span className="text-[11px] text-foreground-faint">sem Safe</span>
          )}
          <ChevronDown className={`h-4 w-4 text-foreground-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-border p-3">
          {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          <label className="block text-xs text-foreground-muted">Endereço do Safe <span className="text-foreground-faint">(mesmo endereço em Base e Ethereum)</span>
            <div className="mt-1 flex items-center gap-2">
              <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
              <button type="button" onClick={save} disabled={saving || !addr.trim()} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
              </button>
            </div>
          </label>

          {project.safeAddress && (
            <div className="grid gap-2 sm:grid-cols-2">
              {project.chains.map((c) => (
                <div key={c.chainId} className="rounded-lg border border-border bg-surface-elevated p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">{c.name}</span>
                    {!c.exists ? (
                      <span className="text-[10px] text-foreground-faint">Safe não existe aqui</span>
                    ) : c.delegate === true ? (
                      <span className="flex items-center gap-1 text-[10px] text-success"><CheckCircle2 className="h-3 w-3" /> delegate</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-warning"><XCircle className="h-3 w-3" /> sem delegate</span>
                    )}
                  </div>
                  {c.exists && <p className="mt-1 text-[11px] tabular-nums text-foreground-muted">{c.balances}</p>}
                  {c.exists && project.safeAddress && (
                    <a href={safeAppUrl(c.chainId, project.safeAddress)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent hover:underline">
                      Abrir no Safe <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  {c.exists && c.delegate !== true && (
                    <p className="mt-1 text-[10px] text-warning">Registre o proposer como delegate desta rede no app.safe.global.</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {project.safeAddress && (
            <p className="text-[11px] text-foreground-faint">{readyChains > 0 ? `Pronto pra pagar em ${readyChains} rede(s).` : "Nenhuma rede pronta ainda — registre o delegate."}</p>
          )}
        </div>
      )}
    </div>
  );
}
