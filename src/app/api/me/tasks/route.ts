import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAllProjects, getProject } from "@/projects";
import { verifySession } from "@/lib/team-access";
import { identidades } from "@/lib/member-identity";
import { resolveGitHubToken } from "@/lib/github-project";

/**
 * As tarefas que importam para quem está perguntando, entre todos os boards a
 * que ela tem acesso.
 *
 * Existe para a nova aba da extensão: mostrar as três primeiras e um relógio
 * até o prazo mais próximo. Carregar os boards inteiros (como faz /api/kanban)
 * seria caro demais para uma página que abre a cada aba nova.
 *
 * O caminho barato: `CardPriority` é nosso, mora no Postgres e já tem dono,
 * fogo e prazo. Filtramos e ordenamos lá, e só então buscamos os títulos no
 * GitHub — numa única consulta por `nodes(ids:)`, com os poucos ids que
 * sobraram.
 */

type Tarefa = {
  itemId: string;
  projectSlug: string;
  projectName: string;
  title: string;
  url: string | null;
  priority: number;
  deadline: string | null;
  status: string | null;
};

/** Títulos + status de vários cards de UM board, numa consulta só. */
async function resolverCards(
  token: string,
  ids: string[],
): Promise<Map<string, { title: string; url: string | null; status: string | null; vivo: boolean }>> {
  const out = new Map<string, { title: string; url: string | null; status: string | null; vivo: boolean }>();
  if (!ids.length) return out;
  const query = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProjectV2Item {
    id isArchived
    content{ ... on DraftIssue{title} ... on Issue{title url state} ... on PullRequest{title url state} }
    fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue{ name field{ ... on ProjectV2SingleSelectField{name} } } } }
  } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { ids } }),
    // Sem cache: um card que saiu do "Todo" há um minuto não pode voltar aqui.
    cache: "no-store",
  });
  if (!res.ok) return out;
  const json = (await res.json()) as {
    data?: { nodes?: (null | Record<string, unknown>)[] };
  };
  for (const n of json.data?.nodes ?? []) {
    if (!n) continue; // card apagado — a linha de prioridade ficou órfã
    const id = n.id as string;
    const content = (n.content ?? {}) as { title?: string; url?: string; state?: string };
    const campos = ((n.fieldValues as { nodes?: { name?: string; field?: { name?: string } }[] })?.nodes ?? [])
      .filter((f) => f?.field?.name === "Status");
    const status = campos[0]?.name ?? null;
    const fechado = content.state === "CLOSED" || content.state === "MERGED";
    const pronto = /done|conclu|shipped|complete/i.test(status ?? "");
    out.set(id, {
      title: content.title ?? "(sem título)",
      url: content.url ?? null,
      status,
      vivo: !n.isArchived && !fechado && !pronto,
    });
  }
  return out;
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = sessionTokenFromRequest(req, cookieStore.get(SESSION_COOKIE)?.value);
  const sessao = await verifySession(token);
  if (!sessao) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const limite = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 3) || 3, 10);

  // Boards em que a sessão pode escrever.
  const candidatos = getAllProjects().filter((p) => p.githubProject);
  const permitidos = (
    await Promise.all(candidatos.map(async (p) => ((await verifySession(token, p)) ? p : null)))
  ).filter((p): p is NonNullable<typeof p> => !!p);
  if (!permitidos.length) return NextResponse.json({ ok: true, mine: [], suggested: [], username: sessao.username });

  const slugs = permitidos.map((p) => p.slug);
  // A pessoa pode aparecer como dona sob qualquer um dos seus apelidos — usuário
  // do portal, login do GitHub, carteira. `identidades` já resolve isso.
  const apelidos = await identidades(sessao.username);

  const brutas = await prisma.cardPriority.findMany({
    where: { projectSlug: { in: slugs } },
    select: { itemId: true, projectSlug: true, priority: true, deadline: true, owner: true },
  });
  // `projectSlug` é anulável no schema; sem ele não há board para resolver o
  // título, então a linha não serve para nada aqui.
  const linhas = brutas.filter(
    (l): l is typeof l & { projectSlug: string } => typeof l.projectSlug === "string",
  );

  const meu = (owner: string | null) => !!owner && apelidos.some((a) => a.toLowerCase() === owner.toLowerCase());
  const minhas = linhas.filter((l) => meu(l.owner));
  // Sem nada com dono, uma aba vazia não ajuda ninguém. Devolvemos o que está
  // pegando fogo nos boards dela, marcado como sugestão — dizer "não é sua, mas
  // é o mais quente" é mais útil que não dizer nada.
  const base = minhas.length ? minhas : linhas.filter((l) => l.priority >= 4);

  // Prazo primeiro (o que vence antes sobe), depois fogo. Sem prazo vai para o fim.
  const ordenadas = [...base].sort((a, b) => {
    const da = a.deadline ? a.deadline.getTime() : Infinity;
    const db = b.deadline ? b.deadline.getTime() : Infinity;
    if (da !== db) return da - db;
    return b.priority - a.priority;
  });

  // Resolvemos mais do que o pedido porque parte vai cair no filtro de "vivo".
  const fatia = ordenadas.slice(0, limite * 4);
  const porProjeto = new Map<string, string[]>();
  for (const l of fatia) {
    if (!porProjeto.has(l.projectSlug)) porProjeto.set(l.projectSlug, []);
    porProjeto.get(l.projectSlug)!.push(l.itemId);
  }

  const resolvidos = new Map<string, Awaited<ReturnType<typeof resolverCards>> extends Map<string, infer V> ? V : never>();
  await Promise.all(
    [...porProjeto.entries()].map(async ([slug, ids]) => {
      const proj = getProject(slug);
      const gh = resolveGitHubToken(proj);
      if (!gh) return;
      const m = await resolverCards(gh, ids).catch(() => new Map());
      for (const [k, v] of m) resolvidos.set(k, v);
    }),
  );

  const montar = (l: (typeof fatia)[number]): Tarefa | null => {
    const c = resolvidos.get(l.itemId);
    if (!c || !c.vivo) return null;
    return {
      itemId: l.itemId,
      projectSlug: l.projectSlug,
      projectName: getProject(l.projectSlug).name,
      title: c.title,
      url: c.url,
      priority: l.priority,
      deadline: l.deadline ? l.deadline.toISOString() : null,
      status: c.status,
    };
  };

  const tarefas = fatia.map(montar).filter((t): t is Tarefa => !!t).slice(0, limite);

  return NextResponse.json({
    ok: true,
    username: sessao.username,
    /** true quando não há nada com dono e estamos mostrando o mais quente do board. */
    suggested: minhas.length === 0,
    tasks: tarefas,
    asOf: new Date().toISOString(),
  });
}
