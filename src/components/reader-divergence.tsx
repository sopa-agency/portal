import { isOk, type Reading } from "@/lib/reading";
import type { ReaderDivergence } from "@/lib/treasury-history";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Quanto os dois leitores do tesouro discordam.
 *
 * Está na tela, e não só no payload, de propósito: contagem que vive apenas no
 * JSON é a próxima ocorrência esperando acontecer. Se ninguém vê, ninguém age,
 * e a divergência volta a ser suposição — que é exatamente o estado do qual
 * esta medição existe para sair.
 *
 * Mora sob "Operar" porque é diagnóstico de operação, não resposta à pergunta
 * "quanto temos" — e disputar aquela tela com ela seria o erro de hierarquia
 * que a página já corrigiu uma vez.
 */
export function ReaderDivergencePanel({ data }: { data: Reading<ReaderDivergence[]> }) {
  if (!isOk(data)) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h4 className="text-sm font-semibold text-foreground">Divergência entre leitores</h4>
        <p className="mt-1.5 text-xs text-foreground-muted">
          {data.state === "unread" ? `⚠ Não pôde ser lida — ${data.reason}` : data.note}
        </p>
      </section>
    );
  }

  const rows = data.value;
  const comparable = rows.filter((r) => r.deltaUsd != null);
  const worst = comparable[0]?.deltaPct ?? null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Divergência entre leitores</h4>
        <span className="text-[11px] text-foreground-subtle">
          {comparable.length} de {rows.length} carteiras comparáveis
          {worst != null ? ` · maior: ${worst.toFixed(1)}%` : ""}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-foreground-subtle">
        <span className="font-medium text-foreground-muted">endereço</span> = leitor do snapshot (Zerion primeiro, vê
        posição de protocolo) · <span className="font-medium text-foreground-muted">página</span> = leitor do hero
        (fan-out de RPC, lê os extraTokens da config). Enquanto os dois existirem, a saúde medida por um fala do
        caminho dele.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-foreground-faint">
            <tr>
              <th className="pb-1.5 font-semibold">Carteira</th>
              <th className="pb-1.5 text-right font-semibold">endereço</th>
              <th className="pb-1.5 text-right font-semibold">página</th>
              <th className="pb-1.5 text-right font-semibold">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.address}>
                <td className="py-1.5 pr-2 text-foreground">{r.label}</td>
                {/* Leitor que não leu mostra travessão, nunca 0 — a coluna
                    inteira é sobre distinguir número de ausência. */}
                <td className="py-1.5 text-right tabular-nums text-foreground-muted">
                  {r.addressUsd == null ? "—" : usd(r.addressUsd)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-foreground-muted">
                  {r.walletUsd == null ? "—" : usd(r.walletUsd)}
                </td>
                <td
                  className={`py-1.5 text-right tabular-nums font-semibold ${
                    r.deltaPct == null
                      ? "text-foreground-faint"
                      : r.deltaPct > 5
                        ? "text-warning"
                        : "text-foreground-muted"
                  }`}
                >
                  {r.deltaUsd == null
                    ? "não comparável"
                    : `${r.deltaUsd >= 0 ? "+" : "−"}${usd(Math.abs(r.deltaUsd))}${
                        r.deltaPct != null ? ` (${r.deltaPct.toFixed(1)}%)` : ""
                      }`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-[10px] leading-snug text-foreground-faint">
        Só o TOTAL é comparado. Um diff por token exigiria chave de identidade, e o que existe hoje é símbolo + chain —
        que é a chave errada: dois contratos podem carregar o mesmo símbolo. O diff por token vem quando o token
        carregar o endereço do contrato.
      </p>
    </section>
  );
}
