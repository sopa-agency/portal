import Link from "next/link";
import { KanbanSquare } from "lucide-react";

/**
 * Como os kanbans estão AGORA, um board por linha.
 *
 * O home da SOPA já tinha o feed de atividade, mas feed é movimento, não
 * estado: ele responde "o que aconteceu" e não "quanto falta". E ele nasce de
 * evento do GitHub, que só existe para issue e PR — a maioria dos nossos cards
 * é rascunho, então o feed mostra um board quase parado mesmo num dia cheio.
 *
 * Aqui a conta vem do estado das colunas, que enxerga rascunho igual, e por
 * isso é o número que bate com o que a pessoa vê ao abrir o board.
 *
 * O que NÃO dá para dizer honestamente: "concluídas esta semana". Card não
 * guarda quando entrou em Done, e rascunho não tem data de fechamento. Preferi
 * não ter a métrica a estimá-la.
 */

export type BoardProgress = {
  slug: string;
  name: string;
  accent: string;
  andamento: number;
  revisao: number;
  prontas: number;
  backlog: number;
};

const FAIXAS: { key: keyof Pick<BoardProgress, "andamento" | "revisao" | "prontas" | "backlog">; label: string; cor: string }[] = [
  { key: "andamento", label: "em andamento", cor: "bg-warning" },
  { key: "revisao", label: "em revisão", cor: "bg-accent" },
  { key: "prontas", label: "prontas", cor: "bg-success" },
  { key: "backlog", label: "backlog", cor: "bg-foreground-faint/40" },
];

export function KanbanProgress({ boards }: { boards: BoardProgress[] }) {
  const vivos = boards.filter((b) => b.andamento + b.revisao + b.prontas + b.backlog > 0);
  if (!vivos.length) return null;

  const aberto = (b: BoardProgress) => b.andamento + b.revisao + b.prontas + b.backlog;
  const total = vivos.reduce((n, b) => n + aberto(b), 0);
  const emCurso = vivos.reduce((n, b) => n + b.andamento + b.revisao, 0);
  // A barra é proporcional ao MAIOR board, não a si mesma: assim um board de 8
  // cards não ocupa a mesma largura que um de 60, que é a comparação que
  // importa quando as linhas estão empilhadas.
  const maior = Math.max(...vivos.map(aberto));

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <KanbanSquare className="h-5 w-5 text-accent" /> Kanban · como estão os boards
        </h2>
        <Link href="/kanban" className="text-xs font-medium text-foreground-muted hover:text-foreground">
          Abrir o kanban →
        </Link>
      </div>
      <p className="mb-4 text-xs text-foreground-faint">
        {total} tarefas abertas, {emCurso} em curso agora.
      </p>

      <div className="space-y-2.5">
        {vivos.map((b) => {
          const abertas = aberto(b);
          return (
            <div key={b.slug} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm font-medium text-foreground" title={b.name}>
                {b.name}
              </span>
              <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                {FAIXAS.map((f) =>
                  b[f.key] > 0 ? (
                    <div
                      key={f.key}
                      className={f.cor}
                      style={{ width: `${(b[f.key] / maior) * 100}%` }}
                      title={`${b[f.key]} ${f.label}`}
                    />
                  ) : null,
                )}
              </div>
              <span className="w-[9.5rem] shrink-0 text-right text-xs tabular-nums text-foreground-faint">
                <span className="text-warning">{b.andamento}</span> em andamento ·{" "}
                <span className="text-foreground-muted">{abertas}</span> abertas
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-foreground-faint">
        {FAIXAS.map((f) => (
          <span key={f.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${f.cor}`} /> {f.label}
          </span>
        ))}
      </div>
    </section>
  );
}
