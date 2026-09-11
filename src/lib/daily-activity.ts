import "server-only";
import { fetchKanbanActivity, fetchRecentCommits, type KanbanActivityEvent } from "@/lib/github-project";
import { identidades } from "@/lib/member-identity";
import { getAllProjects } from "@/projects/index";

/**
 * O que uma pessoa fez num dia, nas fontes que o portal já lê.
 *
 * Existe para o relatório diário: escrever do zero "o que eu fiz hoje" é a
 * parte cara, e quase tudo já está registrado em algum lugar. A tela mostra a
 * lista e a pessoa clica no que quer contar.
 *
 * Não é vigilância nem métrica: nada disso vira o relatório sozinho, e o que
 * não foi clicado não é gravado. É rascunho, e quem decide o que conta é quem
 * escreve — commit não é trabalho, é rastro de trabalho.
 */

export type AtividadeItem = {
  kind: "commit" | "card";
  /** Identificador estável na origem: sha do commit, ou id do item no board. */
  ref: string;
  /** A linha que entra no relatório quando a pessoa clica. */
  label: string;
  url?: string;
  /** De onde veio, para a tela agrupar: nome do repo ou do board. */
  origem: string;
  ts: string;
};

export type AtividadeDoDia = {
  commits: AtividadeItem[];
  cards: AtividadeItem[];
  /** Logins do GitHub que casamos com esta pessoa — a tela diz quais, porque
   *  uma lista vazia por identidade não mapeada parece um dia sem trabalho. */
  logins: string[];
  erros: string[];
};

const VERBO: Record<KanbanActivityEvent["kind"], string> = {
  opened: "abri",
  closed: "fechei",
  merged: "mergeei",
  commented: "comentei em",
};

/** Início e fim do dia, no fuso de São Paulo, onde a equipe trabalha. */
function janelaDoDia(diaIso: string): { de: Date; ate: Date } {
  // -03:00 fixo: o Brasil não tem horário de verão desde 2019, e depender do
  // fuso do servidor faria o relatório das 21h cair no dia seguinte na Vercel.
  const de = new Date(`${diaIso}T00:00:00-03:00`);
  const ate = new Date(`${diaIso}T23:59:59.999-03:00`);
  return { de, ate };
}

export async function atividadeDoDia(username: string, diaIso: string): Promise<AtividadeDoDia> {
  const { de, ate } = janelaDoDia(diaIso);
  const erros: string[] = [];
  const apelidos = await identidades(username).catch(() => [username.toLowerCase()]);
  const logins = new Set(apelidos.map((a) => a.toLowerCase()));
  const dentro = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= de.getTime() && t <= ate.getTime();
  };

  // ── cards: o feed de atividade já agrega todos os boards ──
  let cards: AtividadeItem[] = [];
  try {
    const eventos = await fetchKanbanActivity(200);
    cards = eventos
      .filter((e) => e.actor && logins.has(e.actor.login.toLowerCase()) && dentro(e.ts))
      .map((e) => ({
        kind: "card" as const,
        ref: e.url ?? `${e.projectSlug}:${e.title}`,
        label: `${VERBO[e.kind]} “${e.title}”${e.number ? ` (#${e.number})` : ""}`,
        url: e.url,
        origem: e.project,
        ts: e.ts,
      }));
  } catch (e) {
    erros.push(`atividade do kanban: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── commits: por projeto, porque é assim que os repos são declarados ──
  const projetos = getAllProjects().filter((p) => p.repos?.length);
  const porProjeto = await Promise.all(
    projetos.map(async (p) => {
      try {
        return await fetchRecentCommits(p, de.toISOString());
      } catch (e) {
        erros.push(`commits de ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    }),
  );
  const vistos = new Set<string>();
  const commits: AtividadeItem[] = [];
  for (const c of porProjeto.flat()) {
    if (!logins.has((c.author ?? "").toLowerCase()) || !dentro(c.date)) continue;
    // O mesmo commit aparece uma vez por projeto que declara o repo.
    if (vistos.has(c.sha)) continue;
    vistos.add(c.sha);
    commits.push({
      kind: "commit",
      ref: c.sha,
      // Só o assunto: um corpo de commit inteiro não cabe numa linha de relatório.
      label: c.message.split("\n")[0].slice(0, 140),
      url: `https://github.com/${c.repo}/commit/${c.sha}`,
      origem: c.repo.split("/").pop() ?? c.repo,
      ts: c.date,
    });
  }

  const maisNovoPrimeiro = (a: AtividadeItem, b: AtividadeItem) => b.ts.localeCompare(a.ts);
  return {
    commits: commits.sort(maisNovoPrimeiro),
    cards: cards.sort(maisNovoPrimeiro),
    logins: [...logins],
    erros,
  };
}
