import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { buildChatContext } from "@/lib/chat-context";

export const runtime = "nodejs";

// O bloco [contexto] do portal, servido como texto.
//
// POR QUE ISTO EXISTE
//
// O contexto é EMPURRADO: /api/chat/send monta o bloco e cola no prompt. Isso
// funciona para o chat do portal e não funciona para mais nada — quando a
// pessoa fala com o mesmo agente pelo Telegram, a mensagem vai direto ao
// gateway do OpenClaw e o bloco não existe. O agente responde sobre o portal
// sem ter visto o portal.
//
// Esta rota é o outro lado: quem está FORA do portal pode vir buscar. O cron da
// máquina do Vlad chama de manhã e de noite, grava num arquivo do workspace do
// secretário, e aí o agente tem no Telegram o mesmo que tem no chat.
//
// AUTENTICAÇÃO: a mesma sessão de qualquer página, nada de token novo. Quem
// chama de fora assina um cookie com o SESSION_SECRET que já está na máquina —
// nenhuma credencial foi criada para isto existir. E `authorize` continua
// decidindo: sessão válida sem acesso a este portal não passa.
export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const who = await authorize(token, project);
  if (!who) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const ctx = await buildChatContext(project);
  const formato = req.nextUrl.searchParams.get("format");
  if (formato === "json") {
    return NextResponse.json({ ok: true, project: project.slug, chars: ctx.chars, block: ctx.block });
  }
  // Texto puro por padrão: quem consome isto é um arquivo lido por um agente,
  // e JSON escapado seria uma camada de ruído entre ele e o conteúdo.
  return new NextResponse(ctx.block, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
