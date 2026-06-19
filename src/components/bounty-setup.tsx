"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, ChevronDown, ExternalLink, RefreshCw, CircleDashed } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { getBountySetup, saveBountyConfig, type ProjectBounty, type ChainStatus } from "@/app/actions/bounty";

const safeAppUrl = (chainId: number, address: string) => `https://app.safe.global/home?safe=${chainId === 1 ? "eth" : "base"}:${address}`;
const isReady = (c: ChainStatus) => c.exists && c.delegate === true;
const isFunded = (c: ChainStatus) => c.exists && !!c.balances && c.balances !== "vazio";

export function BountySetup() {
  const [proposer, setProposer] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectBounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setRefreshing(true);
    const r = await getBountySetup();
    setLoading(false);
    setRefreshing(false);
    if (r.ok) { setProposer(r.proposer); setProjects(r.projects); setErr(null); }
    else setErr(r.error);
  }
  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-sm text-foreground-muted"><Loader2 className="inline h-4 w-4 animate-spin" /> Lendo Safes ao vivo…</p>;

  const configured = projects.filter((p) => p.safeAddress);
  const readyCount = configured.filter((p) => p.chains.some(isReady)).length;

  return (
    <section aria-labelledby="bounty-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="bounty-heading" className="text-lg font-semibold tracking-tight text-foreground">Bounties &amp; Safe</h2>
        <span className="text-xs text-foreground-faint">{readyCount}/{configured.length} portais prontos pra pagar</span>
        <button type="button" onClick={load} disabled={refreshing} className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Proposer — delegate de cada Safe (só propõe, nunca executa)</div>
        {proposer ? (
          <CopyButton value={proposer} className="mt-1 flex w-full items-center gap-1.5 truncate font-mono text-xs text-accent hover:underline">
            {proposer}
          </CopyButton>
        ) : (
          <p className="mt-1 text-xs text-danger">⚠ SAFE_PROPOSER_PRIVATE_KEY não configurado no servidor.</p>
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

/** One explicit status line in the per-chain checklist. */
function Line({ state, children }: { state: "ok" | "bad" | "pending" | "neutral"; children: React.ReactNode }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "bad" ? XCircle : state === "pending" ? Loader2 : CircleDashed;
  const tone = state === "ok" ? "text-success" : state === "bad" ? "text-warning" : "text-foreground-muted";
  return (
    <span className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
      <Icon className={`h-3 w-3 shrink-0 ${state === "pending" ? "animate-spin" : ""}`} /> {children}
    </span>
  );
}

/** Compact overall-status chip for the collapsed row. */
function OverallChip({ project }: { project: ProjectBounty }) {
  if (!project.safeAddress) return <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-faint">sem Safe</span>;
  if (project.chains.length === 0) return <span className="flex items-center gap-1 text-[10px] text-foreground-faint"><Loader2 className="h-3 w-3 animate-spin" /> checando…</span>;
  const ready = project.chains.filter(isReady);
  if (ready.length > 0) {
    return <span className="flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"><CheckCircle2 className="h-3 w-3" /> Pronto · {ready.map((c) => c.name).join(", ")}</span>;
  }
  return <span className="flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning"><XCircle className="h-3 w-3" /> falta delegate</span>;
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

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-elevated">
        <span className="text-sm font-semibold text-foreground">{project.name}</span>
        <span className="flex items-center gap-2">
          <OverallChip project={project} />
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
              {project.chains.map((c) => {
                const ready = isReady(c);
                const tint = !c.exists ? "border-border opacity-70" : ready ? "border-success/40" : "border-warning/40";
                return (
                  <div key={c.chainId} className={`space-y-1.5 rounded-lg border bg-surface-elevated p-2.5 ${tint}`}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        {c.name}
                        {c.exists && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${ready ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{ready ? "PRONTO" : "AÇÃO"}</span>
                        )}
                      </span>
                      {c.exists && project.safeAddress && (
                        <a href={safeAppUrl(c.chainId, project.safeAddress)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-accent hover:underline">
                          Abrir <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>

                    {!c.exists ? (
                      <Line state="bad">Safe não está implantado nesta rede</Line>
                    ) : (
                      <>
                        <Line state="ok">Safe implantado</Line>
                        <Line state={c.delegate === null ? "pending" : c.delegate ? "ok" : "bad"}>
                          {c.delegate === null ? "Verificando delegate…" : c.delegate ? "Proposer é delegate" : "Proposer NÃO é delegate"}
                        </Line>
                        <Line state={isFunded(c) ? "neutral" : "bad"}>Saldo: {c.balances || "vazio"}</Line>
                      </>
                    )}

                    {c.exists && c.delegate === false && (
                      <p className="text-[10px] text-warning">→ Registre o proposer como delegate desta rede no app.safe.global.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {project.safeAddress && (
            <p className="text-[11px] text-foreground-faint">
              {project.chains.some(isReady)
                ? `Pronto pra pagar em: ${project.chains.filter(isReady).map((c) => c.name).join(", ")}.`
                : "Nenhuma rede pronta — registre o proposer como delegate."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
