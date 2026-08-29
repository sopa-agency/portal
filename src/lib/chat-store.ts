import "server-only";

// Acesso às conversas do /chat.
//
// Uma regra manda em tudo aqui: conversa é de UMA PESSOA. Não é do portal, não
// é do time. Toda leitura filtra por projectSlug E username — não porque a
// conversa seja secreta, mas porque ninguém espera que o colega leia o que ela
// perguntou ao agente. Um `findUnique` por id sozinho quebraria isso em
// silêncio, e por isso não existe nenhum aqui.

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";
import { prisma } from "@/lib/prisma";
import type { ProjectConfig } from "@/projects/types";

export type ChatSession = {
  project: ProjectConfig;
  username: string;
};

/** Sessão + projeto, ou null quando não dá para atender o pedido. */
export async function chatSession(): Promise<ChatSession | null> {
  const project = await getActiveProject();
  if (!project.chat) return null;
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return null;
  return { project, username: session.username };
}

/** Sufixo de sessão do gateway — mantém a thread do agente por conversa. */
export function sessionKeyFor(conversationId: string): string {
  return `chat-${conversationId}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
}

export async function listConversations(s: ChatSession) {
  return prisma.chatConversation.findMany({
    where: { projectSlug: s.project.slug, username: s.username },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, pinned: true, updatedAt: true, createdAt: true },
    take: 200,
  });
}

export async function createConversation(s: ChatSession, title = "") {
  const row = await prisma.chatConversation.create({
    data: { projectSlug: s.project.slug, username: s.username, title, sessionKey: "" },
  });
  // sessionKey deriva do id, que só existe depois do insert.
  return prisma.chatConversation.update({
    where: { id: row.id },
    data: { sessionKey: sessionKeyFor(row.id) },
  });
}

/** A conversa, se ela for DESTA pessoa neste portal. Senão, null. */
export async function ownedConversation(s: ChatSession, id: string) {
  return prisma.chatConversation.findFirst({
    where: { id, projectSlug: s.project.slug, username: s.username },
  });
}

export async function conversationWithMessages(s: ChatSession, id: string) {
  return prisma.chatConversation.findFirst({
    where: { id, projectSlug: s.project.slug, username: s.username },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          attachments: {
            select: { id: true, name: true, mimeType: true, size: true, token: true, text: true },
          },
        },
      },
    },
  });
}

/**
 * Título a partir da primeira pergunta.
 *
 * Sem isto a barra lateral vira uma pilha de "Nova conversa" e a pessoa não
 * acha nada. Não chamamos o agente para titular: custaria uma rodada inteira
 * por conversa para uma linha de texto que a primeira frase já dá.
 */
export function titleFrom(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "Nova conversa";
  const cut = clean.slice(0, 60);
  return cut.length < clean.length ? `${cut}...` : cut;
}
