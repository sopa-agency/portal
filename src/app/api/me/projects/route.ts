import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFromRequest } from "@/lib/auth";
import { getAllProjects } from "@/projects";
import { verifySession } from "@/lib/team-access";

/**
 * Os projetos em que ESTA sessão pode escrever.
 *
 * Existe para a extensão de kanban da equipe: o seletor de projeto precisa
 * mostrar só o que a pessoa pode mesmo usar, senão ela escolhe um board e
 * descobre pelo 403 que não tinha acesso.
 *
 * `verifySession(token, project)` já resolve identidade + associação, então
 * aqui é só perguntar projeto a projeto. A lista é pequena (dezenas), e a
 * resposta não é cacheável porque depende de quem está perguntando.
 */
export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = sessionTokenFromRequest(req, cookieStore.get(SESSION_COOKIE)?.value);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const projetos = getAllProjects().filter((p) => p.githubProject);
  const checados = await Promise.all(
    projetos.map(async (p) => ({ p, ok: !!(await verifySession(token, p)) })),
  );
  const permitidos = checados.filter((c) => c.ok);

  if (permitidos.length === 0) {
    // Sessão válida mas sem board nenhum: é diferente de não estar logado, e a
    // extensão precisa distinguir para mostrar a mensagem certa.
    return NextResponse.json({ ok: true, username: null, projects: [] });
  }

  return NextResponse.json({
    ok: true,
    username: (await verifySession(token))?.username ?? null,
    projects: permitidos.map(({ p }) => ({ slug: p.slug, name: p.name })),
  });
}
