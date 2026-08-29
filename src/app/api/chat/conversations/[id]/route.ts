import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatSession, ownedConversation, conversationWithMessages } from "@/lib/chat-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const s = await chatSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const conversation = await conversationWithMessages(s, id);
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversa não encontrada." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      pinned: conversation.pinned,
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        error: m.error,
        createdAt: m.createdAt,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          token: a.token,
          // O conteúdo do texto não volta para a tela: a pessoa já sabe o que
          // mandou, e devolver um CSV inteiro por mensagem engorda a resposta
          // à toa. Só dizemos SE foi lido como texto, que é o que ela precisa
          // saber para entender o que o agente enxergou.
          inlined: a.text !== null,
        })),
      })),
    },
  });
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const s = await chatSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const existing = await ownedConversation(s, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Conversa não encontrada." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { title?: unknown; pinned?: unknown };
  const data: { title?: string; pinned?: boolean } = {};
  if (typeof body.title === "string") data.title = body.title.trim().slice(0, 120);
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "Nada para atualizar." }, { status: 400 });
  }

  const conversation = await prisma.chatConversation.update({ where: { id }, data });
  return NextResponse.json({ ok: true, conversation });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const s = await chatSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const existing = await ownedConversation(s, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Conversa não encontrada." }, { status: 404 });
  }
  // Mensagens e anexos saem junto pelo ON DELETE CASCADE.
  await prisma.chatConversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
