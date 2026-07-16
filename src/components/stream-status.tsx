import { Radio, AlertTriangle, Link2Off } from "lucide-react";
import type { StreamStatus } from "@/lib/superfluid";
import type { PayrollMemberDTO } from "@/app/actions/payroll";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

// Live on-chain state of the SOPA payroll pool (read-only). Sits above the
// PayrollPanel in the Membros tab. Degrades gracefully before a pool exists.
export function StreamStatus({
  data,
  poolConfigured,
  portalMembers,
}: {
  data: StreamStatus | null;
  poolConfigured: boolean;
  portalMembers: PayrollMemberDTO[];
}) {
  if (!poolConfigured || !data) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Radio className="h-4 w-4 text-foreground-faint" /> Status do stream on-chain
        </h3>
        <p className="mt-1.5 text-xs text-foreground-subtle">
          A pool de distribuição ainda não foi criada. Assim que ela existir on-chain (Fase B — criar/assinar no Safe),
          o status ao vivo aparece aqui: taxa mensal, runway, e quem está conectado.
        </p>
      </div>
    );
  }

  const on = data.flowRatePerSec > 0;
  const portalByAddr = new Map(portalMembers.map((m) => [m.address.toLowerCase(), m]));
  const notConnected = data.members.filter((m) => m.units > 0 && !m.connected);
  const runwayTone =
    data.runwayDays == null ? "text-foreground-muted" : data.runwayDays < 14 ? "text-danger" : data.runwayDays < 45 ? "text-warning" : "text-success";

  const stat = (label: string, value: string, tone = "text-foreground") => (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Radio className={`h-4 w-4 ${on ? "text-success" : "text-foreground-faint"}`} /> Status do stream on-chain
        </h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${on ? "bg-success/15 text-success" : "bg-foreground/10 text-foreground-muted"}`}>
          {on ? "ativo" : "parado"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stat("Mensal", usd(data.monthlyUsd))}
        {stat("Runway", data.runwayDays == null ? "∞" : `${Math.floor(data.runwayDays)}d`, runwayTone)}
        {stat("USDCx no Safe", usd(data.safeUsdcxUsd))}
        {stat("Conectados", `${data.members.filter((m) => m.connected).length}/${data.members.length}`)}
      </div>

      {data.runwayDays != null && data.runwayDays < 14 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border-l-[3px] border-danger bg-danger/10 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
          Runway baixo ({Math.floor(data.runwayDays)}d). Abasteça USDCx no Safe — se zerar, o stream é liquidado e o buffer é penalizado.
        </div>
      )}

      {notConnected.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            {notConnected.length} membro(s) ainda não conectaram à pool — a fatia deles acumula mas não pinga em tempo real. Cada um precisa conectar a própria carteira uma vez.
          </span>
        </div>
      )}

      {/* Per-member: on-chain vs portal units (drift → sincronizar na Fase C). */}
      {data.members.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {data.members.map((m) => {
            const portal = portalByAddr.get(m.address.toLowerCase());
            const drift = portal && portal.units !== m.units;
            return (
              <li key={m.address} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-foreground-muted">
                  {portal?.label ?? `${m.address.slice(0, 6)}…${m.address.slice(-4)}`}
                  {!m.connected && <span className="ml-1.5 text-warning">• não conectado</span>}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-foreground-faint">
                  {m.units}u{drift && <span className="text-warning"> (portal: {portal!.units}u)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
