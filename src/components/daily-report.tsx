"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, ExternalLink, GitCommitHorizontal, Loader2, Plus, SquareKanban } from "lucide-react";
import { carregarDia, salvarDia, type Relatorio } from "@/app/actions/daily-report";
import type { AtividadeDoDia, AtividadeItem } from "@/lib/daily-activity";

/**
 * O relatório diário.
 *
 * A parte cara de escrever "o que eu fiz hoje" é lembrar. Então o dia vem
 * montado ao lado — commits e cards daquele dia — e cada linha tem um botão que
 * a joga no texto.
 *
 * Nada entra sozinho. O que a pessoa não clicar não é gravado, e o texto é
 * dela: commit é rastro de trabalho, não o trabalho, e um relatório
 * auto-preenchido seria a máquina falando no lugar de quem fez.
 */

const hoje = () => {
  // Fuso de São Paulo, onde a equipe trabalha — senão quem escreve às 21h já
  // estaria relatando amanhã.
  const d = new Date(Date.now() - 3 * 3600_000);
  return d.toISOString().slice(0, 10);
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function DailyReport({ username }: { username: string }) {
  const [dia, setDia] = useState(hoje);
  const [carregando, setCarregando] = useState(true);
  const [atividade, setAtividade] = useState<AtividadeDoDia | null>(null);
  const [texto, setTexto] = useState("");
  const [usados, setUsados] = useState<AtividadeItem[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const carregar = useCallback(async (d: string) => {
    setCarregando(true);
    setErro(null);
    const r = await carregarDia(d);
    setCarregando(false);
    if (!r.ok) {
      setErro(r.error);
      return;
    }
    setAtividade(r.atividade);
    setTexto(r.relatorio?.body ?? "");
    setUsados(r.relatorio?.items ?? []);
    setSalvoEm(r.relatorio?.atualizadoEm ?? null);
  }, []);

  useEffect(() => {
    void carregar(dia);
  }, [dia, carregar]);

  /** Joga a linha no fim do texto e guarda a referência para depois. */
  function trazer(item: AtividadeItem) {
    setTexto((t) => {
      const linha = `- ${item.label}`;
      if (t.split("\n").some((l) => l.trim() === linha)) return t; // já está lá
      return t.trim() ? `${t.replace(/\s+$/, "")}\n${linha}` : linha;
    });
    setUsados((u) => (u.some((x) => x.ref === item.ref) ? u : [...u, item]));
    area.current?.focus();
  }

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    // Só as referências que sobreviveram no texto: apagar a linha à mão tem de
    // tirar o item também, senão o registro estruturado passa a dizer uma coisa
    // e o texto outra.
    const vivos = usados.filter((i) => texto.includes(i.label));
    const r = await salvarDia({ dia, body: texto, items: vivos });
    setSalvando(false);
    if (r.ok) {
      setUsados(vivos);
      setSalvoEm(r.atualizadoEm);
    } else setErro(r.error);
  }

  const nada = !carregando && atividade && atividade.commits.length === 0 && atividade.cards.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* ── o texto ─────────────────────────────────────────── */}
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label htmlFor="dia" className="text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
            Dia
          </label>
          <input
            id="dia"
            type="date"
            value={dia}
            max={hoje()}
            onChange={(e) => setDia(e.target.value)}
            className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-sm text-foreground"
          />
          {salvoEm && (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <CheckCheck className="h-3.5 w-3.5" /> salvo {hora(salvoEm)}
            </span>
          )}
        </div>

        <textarea
          id="relato"
          ref={area}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={16}
          placeholder={"O que você fez hoje?\n\nUma linha por coisa. Os botões ao lado trazem o que o portal já sabe."}
          className="w-full resize-y rounded-xl border border-border bg-surface-elevated p-4 text-sm leading-relaxed text-foreground placeholder:text-foreground-faint"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !texto.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {salvoEm ? "Atualizar" : "Enviar"}
          </button>
          <span className="text-xs text-foreground-faint">
            {texto.trim().split("\n").filter(Boolean).length} linha(s) · {usados.length} referência(s)
          </span>
          {erro && <span className="text-xs text-danger">{erro}</span>}
        </div>
        <p className="mt-2 text-xs text-foreground-faint">
          Dá para reabrir e corrigir: o relatório de um dia é um só, e salvar de novo substitui.
        </p>
      </section>

      {/* ── o que o portal já sabe ──────────────────────────── */}
      <aside className="min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-subtle">Seu dia, no que ficou registrado</h2>
        <p className="mt-1 text-xs text-foreground-faint">
          Clique para trazer a linha. Nada entra sozinho.
        </p>

        {carregando && (
          <p className="mt-4 flex items-center gap-2 text-xs text-foreground-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> lendo commits e cards…
          </p>
        )}

        {nada && (
          <p className="mt-4 rounded-xl border border-border bg-surface p-3 text-xs text-foreground-muted">
            Nada registrado neste dia
            {atividade!.logins.length > 0 ? (
              <>
                {" "}
                para <span className="font-mono">{atividade!.logins.join(", ")}</span>.
              </>
            ) : (
              <> — e o seu usuário não está ligado a nenhum login do GitHub, então commits não aparecem aqui.</>
            )}{" "}
            Escreva à mão: muito do que a gente faz não vira commit.
          </p>
        )}

        {atividade && atividade.erros.length > 0 && (
          <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            ⚠ Parte da atividade não carregou ({atividade.erros[0]}). O que falta aqui não quer dizer que não
            aconteceu.
          </p>
        )}

        {atividade && atividade.cards.length > 0 && (
          <Lista titulo="Kanban" Icon={SquareKanban} itens={atividade.cards} usados={usados} onTrazer={trazer} />
        )}
        {atividade && atividade.commits.length > 0 && (
          <Lista titulo="Commits" Icon={GitCommitHorizontal} itens={atividade.commits} usados={usados} onTrazer={trazer} />
        )}

        <p className="mt-4 text-[11px] text-foreground-faint">
          Lendo como <span className="font-mono">{username}</span>.
        </p>
      </aside>
    </div>
  );
}

function Lista({
  titulo,
  Icon,
  itens,
  usados,
  onTrazer,
}: {
  titulo: string;
  Icon: typeof SquareKanban;
  itens: AtividadeItem[];
  usados: AtividadeItem[];
  onTrazer: (i: AtividadeItem) => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-faint">
        <Icon className="h-3.5 w-3.5" /> {titulo} · {itens.length}
      </p>
      <ul className="space-y-1.5">
        {itens.map((i) => {
          const dentro = usados.some((u) => u.ref === i.ref);
          return (
            <li key={i.ref} className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2">
              <button
                type="button"
                onClick={() => onTrazer(i)}
                disabled={dentro}
                title={dentro ? "já está no texto" : "trazer para o texto"}
                className="mt-0.5 shrink-0 rounded-md border border-border p-1 text-foreground-muted transition hover:border-accent-border hover:text-accent disabled:opacity-40"
              >
                {dentro ? <CheckCheck className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-xs leading-snug text-foreground">{i.label}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground-faint">
                  <span className="font-mono">{i.origem}</span>
                  <span>{hora(i.ts)}</span>
                  {i.url && (
                    <a
                      href={i.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 hover:text-accent"
                    >
                      abrir <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
