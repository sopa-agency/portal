import { Cloud, HardDrive, Radio, Server, TriangleAlert } from "lucide-react";
import { isOk } from "@/lib/reading";
import { FOLGA_MS, type Corpo, type Frota, type Maquina } from "@/lib/infra";
import { MacOrbit } from "@/components/mac-orbit";
import type { Reading } from "@/lib/reading";

/**
 * Infra — as máquinas que sustentam o que a Vercel não sustenta.
 *
 * Duas listas separadas de propósito. Quem bate ponto no portal está
 * TRABALHANDO; quem está no Tailscale apenas EXISTE na rede. Máquina viva na
 * rede e ausente do ponto é uma máquina ociosa; máquina fora das duas é uma
 * máquina que caiu. Juntar as listas apagaria essa diferença, que é a única
 * coisa que este painel existe para mostrar.
 */

/** Puro: recebe o AGORA em vez de perguntá-lo. Ver ProjectConfig e a regra
 *  react-hooks/purity — render que lê o relógio muda sozinho entre duas
 *  renderizações iguais, e aí "5 min atrás" vira "6 min atrás" sem nada ter
 *  acontecido. */
const rel = (iso: string | null, agora: number) => {
  if (!iso) return "nunca";
  const ms = agora - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h atrás`;
  return `${Math.round(h / 24)} dias atrás`;
};

function Falha({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">
      <TriangleAlert className="mr-1.5 inline h-3.5 w-3.5" />
      {children}
    </p>
  );
}

export function OrgInfra({ frota, tailscale, corpos }: { frota: Reading<Frota>; tailscale: Reading<Maquina[]>; corpos: Corpo[] }) {
  // Cada painel data-se pela SUA leitura. Nenhuma hora entra por prop vinda do
  // render, que é o que a regra de pureza proíbe — e com razão: duas
  // renderizações iguais têm de dar o mesmo resultado.
  const agora = (tailscale.state === "ok" ? tailscale.asOf : undefined) ?? (frota.state === "ok" ? frota.value.lidoEm : 0);
  const vivos = isOk(frota) ? frota.value.hosts.filter((h) => h.vivo).length : null;
  const online = isOk(tailscale) ? tailscale.value.filter((m) => m.online).length : null;

  return (
    <div className="space-y-6">
      {/* ── O desenho, primeiro ──
          As duas listas abaixo são a leitura fina; esta é a de relance. Ela vem
          antes porque "quantas máquinas e como estão" é a pergunta que traz
          alguém a esta aba, e as tabelas respondem devagar demais para ela. */}
      {corpos.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            <Server className="h-4 w-4 text-accent" /> A frota
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground-subtle">
            As máquinas em volta do portal. A linha até o centro diz como cada uma se relaciona com ele —
            cheia é quem publica, tracejada é quem só existe na rede.
          </p>
          <div className="mt-3">
            <MacOrbit corpos={corpos} redeLida={isOk(tailscale)} />
          </div>
        </section>
      )}

      {/* ── Quem está publicando ── */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            <Radio className="h-4 w-4 text-accent" /> Batendo ponto no portal
          </h2>
          {vivos !== null && (
            <span className="font-mono text-xs tabular-nums text-foreground-faint">
              {vivos} viva{vivos === 1 ? "" : "s"} · folga de {Math.round(FOLGA_MS / 60_000)} min
            </span>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground-subtle">
          A máquina de casa é a publicadora principal — IP residencial, e é ela que o Hive e o Instagram
          aceitam. O cron da Vercel só assume quando o ponto fica velho.
        </p>

        {!isOk(frota) ? (
          <div className="mt-3">
            <Falha>
              Não deu para ler quem está batendo ponto{frota.state === "unread" ? ` — ${frota.reason}` : ""}. Isto NÃO
              quer dizer que ninguém está publicando.
            </Falha>
          </div>
        ) : (
          <>
            {frota.value.hosts.length > 0 ? (
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {frota.value.hosts.map((h) => (
                  <li key={h.hostname} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-elevated px-4 py-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${h.vivo ? "bg-success" : "bg-foreground-faint"}`} />
                    <HardDrive className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{h.hostname}</span>
                    <span className={`text-[11px] ${h.vivo ? "text-success" : "text-warning"}`}>
                      {h.vivo ? "publicando" : "ponto velho"}
                    </span>
                    <span className="w-28 text-right text-[11px] text-foreground-faint">{rel(h.lastTickAt, frota.value.lidoEm)}</span>
                    <span className="w-24 text-right font-mono text-[10px] tabular-nums text-foreground-faint">
                      {h.tickCount.toLocaleString("pt-BR")} batidas
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-border-strong bg-surface-elevated px-4 py-3">
                <p className="text-xs leading-relaxed text-foreground-muted">
                  Nenhuma máquina se identificou ainda — mas{" "}
                  <strong className="text-foreground">
                    o ponto do Mac foi batido {rel(frota.value.ultimoTickMac, frota.value.lidoEm)}
                  </strong>
                  , então há uma publicando. O que falta é o nome: o worker precisa mandar o cabeçalho{" "}
                  <code className="rounded bg-surface px-1 py-0.5 font-mono text-[10px]">x-scheduler-host</code> no tick.
                  Sem ele, duas máquinas ligadas apareceriam como uma.
                </p>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-foreground-faint">
              <span>último ponto do Mac: {rel(frota.value.ultimoTickMac, frota.value.lidoEm)}</span>
              <span>
                cross-post pronto: {rel(frota.value.crossPostProntoEm, frota.value.lidoEm)}
                {frota.value.crossPostVelho ? (
                  <span className="ml-1 text-warning">— velho: o publicador não consegue gravar o resultado de volta</span>
                ) : null}
              </span>
            </div>
          </>
        )}
      </section>

      {/* ── A rede ── */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            <Cloud className="h-4 w-4 text-accent" /> Tailscale
          </h2>
          {online !== null && (
            <span className="font-mono text-xs tabular-nums text-foreground-faint">
              {online} online de {isOk(tailscale) ? tailscale.value.length : 0}
            </span>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground-subtle">
          Estar aqui é existir na rede, não é estar trabalhando. Máquina online e sem bater ponto está
          ociosa; máquina fora das duas listas caiu.
        </p>

        {!isOk(tailscale) ? (
          <div className="mt-3 space-y-2">
            <Falha>
              {tailscale.state === "unread" ? tailscale.reason : tailscale.note}
            </Falha>
            <p className="text-[11px] leading-relaxed text-foreground-subtle">
              Para ligar: crie uma chave de API no Tailscale e ponha{" "}
              <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[10px]">TAILSCALE_API_KEY</code> e{" "}
              <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[10px]">TAILSCALE_TAILNET</code>{" "}
              no ambiente. O tailnet é variável de propósito: hoje a rede é a conta pessoal do Vlad e vai virar a da
              SOPA — trocar tem de custar uma variável, não um deploy.
            </p>
          </div>
        ) : tailscale.value.length === 0 ? (
          <p className="mt-3 text-xs text-foreground-faint">A rede respondeu, e não há máquina nenhuma nela.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {tailscale.value.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-elevated px-4 py-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${m.online ? "bg-success" : "bg-foreground-faint"}`} />
                <Server className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{m.nome}</span>
                <span className="text-[11px] text-foreground-muted">{m.so}</span>
                {m.tags.length > 0 && (
                  <span className="font-mono text-[10px] text-accent">{m.tags.join(" ")}</span>
                )}
                <span className="w-24 text-right font-mono text-[10px] text-foreground-faint">
                  {m.enderecos[0] ?? "—"}
                </span>
                <span className="w-28 text-right text-[11px] text-foreground-faint">{rel(m.ultimaVez, agora)}</span>
                {/* Chave que expira derruba a máquina da rede sem aviso — é a
                    causa de queda mais chata de diagnosticar, porque nada muda
                    até o dia em que tudo muda. */}
                {m.expiraEm && (
                  <span
                    className={`text-[10px] ${m.expiraLogo ? "text-warning" : "text-foreground-faint"}`}
                    title="A chave expira e derruba a máquina da rede"
                  >
                    chave expira {new Date(m.expiraEm).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
