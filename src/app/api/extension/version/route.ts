import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFromRequest } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";

/**
 * A versão que a extensão de kanban DEVERIA estar rodando.
 *
 * A extensão é instalada sem compactação, direto de um clone — então ela não se
 * atualiza sozinha e ninguém percebe que ficou para trás. Aqui ela pergunta.
 *
 * Quem consulta o GitHub é o servidor, não a extensão: o repositório é privado,
 * e é melhor um endpoint atrás da sessão do que espalhar token de leitura por
 * navegador da equipe.
 */

const REPO = "sopa-agency/kanban-extension";
const CAMINHO = "manifest.json";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = sessionTokenFromRequest(req, cookieStore.get(SESSION_COOKIE)?.value);
  if (!(await verifySession(token))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const gh = process.env.GITHUB_TOKEN?.trim();
  if (!gh) {
    // Sem token não dá para saber — e "não sei" é diferente de "está atualizada".
    // A extensão precisa poder ficar quieta em vez de dar um alarme falso.
    return NextResponse.json({ ok: false, error: "GITHUB_TOKEN not set", unknown: true });
  }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${CAMINHO}`, {
      headers: { authorization: `Bearer ${gh}`, accept: "application/vnd.github.raw+json" },
      next: { revalidate: 300 }, // 5 min: ninguém publica versão de minuto em minuto
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `GitHub respondeu ${r.status}`, unknown: true });
    }
    const manifest = (await r.json()) as { version?: string };
    const version = (manifest.version ?? "").trim();
    if (!version) return NextResponse.json({ ok: false, error: "manifest sem versão", unknown: true });

    return NextResponse.json({
      ok: true,
      version,
      repo: REPO,
      repoUrl: `https://github.com/${REPO}`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      unknown: true,
      error: e instanceof Error ? e.message : "Falha ao consultar o GitHub",
    });
  }
}
