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

/**
 * Fecha os turnos que ficaram pendentes.
 *
 * Esta e a peca que faz a resposta chegar como no Telegram: a mensagem existe
 * desde que foi pedida, e quem termina o trabalho e o worker, nao o navegador.
 * Ao abrir a conversa a gente pergunta ao AgentJob de cada linha pendente:
 *
 *   done    -> a resposta entra, e o turno vira normal
 *   error   -> a linha fica marcada com o motivo, sem sumir
 *   running -> continua pendente, mas mostrando o que ja escreveu
 *
 * Chamar isto na LEITURA (e nao so quando o cliente avisa) e o que garante a
 * propriedade que importa: fechar a aba, trocar de maquina ou perder a rede nao
 * perde a resposta. Ela esta la quando voce voltar.
 */
export async function settlePendingMessages(conversationId: string): Promise<void> {
  const pending = await prisma.chatMessage.findMany({
    where: { conversationId, status: "pending" },
    select: { id: true, agentJobId: true },
  });
  if (pending.length === 0) return;

  for (const msg of pending) {
    if (!msg.agentJobId) {
      // Pendente sem job e turno orfao: a rota caiu antes de enfileirar. Nao da
      // para esperar por algo que ninguem esta fazendo.
      await prisma.chatMessage
        .update({
          where: { id: msg.id },
          data: { status: "error", error: "O turno se perdeu antes de chegar ao agente." },
        })
        .catch(() => {});
      continue;
    }
    const job = await prisma.agentJob.findUnique({ where: { id: msg.agentJobId } }).catch(() => null);
    if (!job) continue;
    if (job.status === "done") {
      await prisma.chatMessage
        .update({
          where: { id: msg.id },
          data: { status: "done", content: job.result ?? "", error: null },
        })
        .catch(() => {});
    } else if (job.status === "error") {
      await prisma.chatMessage
        .update({
          where: { id: msg.id },
          data: { status: "error", error: (job.error || "O agente falhou.").slice(0, 500) },
        })
        .catch(() => {});
    }
    // queued/running: fica pendente. O texto parcial vem na leitura, abaixo.
  }
}

/** O texto que uma mensagem pendente ja tem — o `partial` do job do worker. */
export async function partialFor(agentJobId: string | null): Promise<string> {
  if (!agentJobId) return "";
  const job = await prisma.agentJob
    .findUnique({ where: { id: agentJobId }, select: { partial: true, result: true } })
    .catch(() => null);
  return (job?.result ?? job?.partial ?? "").trim();
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
