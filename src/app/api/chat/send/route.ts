import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { callOpenClawStream, WorkerStillRunningError } from "@/lib/openclaw-gateway";
import {
  chatSession,
  ownedConversation,
  createConversation,
  titleFrom,
} from "@/lib/chat-store";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  buildAttachmentBlock,
  decodeText,
  looksTextual,
  newAttachmentToken,
  type PromptAttachment,
} from "@/lib/chat-attachments";
import { sanitizeForDb } from "@/lib/sanitize";
import { buildChatContext } from "@/lib/chat-context";

export const runtime = "nodejs";
export const maxDuration = 300;

const MESSAGE_MAX_LENGTH = 32_000;
const HISTORY_TURNS = 16;

// Mesma heurística do chat flutuante: tarefa que mexe em código roda por
// minutos e precisa de orçamento maior. Duplicar a regra seria pedir para as
// duas divergirem, mas ela mora naquele arquivo com o resto da rota antiga —
// quando as duas rotas virarem uma, isto sai daqui.
const HEAVY_RE =
  /\b(repo|repos|reposit[óo]rio|c[óo]digo|code|coding|pull request|\bPR\b|commit|deploy|build|refactor|refatora|implement|implementa|bug|arquivo|file|branch|merge|test[es]?|lint|analis[ae]|analyze|review)\b/i;
const HEAVY_TIMEOUT_MS = 1_200_000;
const LIGHT_TIMEOUT_MS = 590_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Origem pública deste portal — é o que o agente vai buscar para ler anexo. */
async function publicOrigin(req: Request): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: Request): Promise<Response> {
  const s = await chatSession();
  if (!s) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  // ---------------------------------------------------------------------------
  // Entrada — multipart, porque tem arquivo junto
  // ---------------------------------------------------------------------------
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
  }

  const message = String(form.get("message") ?? "").trim();
  const deep = String(form.get("deep") ?? "") === "1";
  const conversationId = String(form.get("conversationId") ?? "").trim();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (!message && files.length === 0) {
    return NextResponse.json({ ok: false, error: "Mensagem vazia." }, { status: 400 });
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ ok: false, error: "Mensagem longa demais." }, { status: 400 });
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      { ok: false, error: `No máximo ${MAX_ATTACHMENTS_PER_MESSAGE} arquivos por mensagem.` },
      { status: 400 },
    );
  }
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { ok: false, error: `"${f.name}" passa do limite de 8 MB por arquivo.` },
        { status: 400 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Conversa
  // ---------------------------------------------------------------------------
  let conversation = conversationId ? await ownedConversation(s, conversationId) : null;
  if (conversationId && !conversation) {
    return NextResponse.json({ ok: false, error: "Conversa não encontrada." }, { status: 404 });
  }
  if (!conversation) conversation = await createConversation(s, titleFrom(message));
  const isFirstTitle = !conversation.title.trim();
  if (isFirstTitle && message) {
    conversation = await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { title: titleFrom(message) },
    });
  }

  // ---------------------------------------------------------------------------
  // Grava a pergunta e os anexos ANTES de chamar o agente
  //
  // Se o turno cair no meio, a pergunta continua na conversa. Gravar depois da
  // resposta faria a pergunta sumir junto com a falha, que é justamente quando
  // a pessoa quer relê-la.
  // ---------------------------------------------------------------------------
  const userMessage = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: sanitizeForDb(message),
    },
  });

  const prompted: PromptAttachment[] = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const asText = looksTextual(file.name, file.type) ? decodeText(buf) : null;
    const row = await prisma.chatAttachment.create({
      data: {
        conversationId: conversation.id,
        messageId: userMessage.id,
        name: file.name.slice(0, 200),
        mimeType: file.type || "application/octet-stream",
        size: buf.length,
        token: newAttachmentToken(),
        // Texto vira texto; o resto vira bytes. Guardar as duas formas do mesmo
        // arquivo só ocuparia banco — o /attachment sabe servir qualquer das duas.
        text: asText === null ? null : sanitizeForDb(asText),
        data: asText === null ? buf : null,
      },
    });
    prompted.push({
      id: row.id,
      token: row.token,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      text: asText,
    });
  }

  // ---------------------------------------------------------------------------
  // Prompt
  // ---------------------------------------------------------------------------
  const history = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id, id: { not: userMessage.id }, error: null },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
    select: { role: true, content: true },
  });
  history.reverse();

  const origin = await publicOrigin(req);
  // O bloco [contexto] — o portal contando ao agente o que ele já sabe. Mesmo
  // padrão do caminho de briefing (ver prompts/secretario.md e chat-context.ts).
  // Nunca lança: no pior caso vem só a camada A, que não faz I/O.
  const context = await buildChatContext(s.project);

  const header =
    `[Portal: ${s.project.name} — agent ${s.project.agent.id}]\n` +
    `[Você está no CHAT do portal, falando com @${s.username}, do time. ` +
    `Responda em markdown quando ajudar: título, lista, bloco de código com a linguagem.]\n\n` +
    context.block;
  const transcript =
    history.length > 0
      ? `\n\n[Conversa até aqui]\n${history
          .map((m) => `${m.role === "user" ? `@${s.username}` : "você"}: ${m.content.slice(0, 1500)}`)
          .join("\n")}`
      : "";
  const attachmentBlock = buildAttachmentBlock(prompted, origin);
  const prompt = `${header}${transcript}${attachmentBlock}\n\n[Mensagem de @${s.username}]\n${message}`;

  // ---------------------------------------------------------------------------
  // SSE
  // ---------------------------------------------------------------------------
  const heavy = deep || HEAVY_RE.test(message);
  const encoder = new TextEncoder();
  const conv = conversation;

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          open = false;
        }
      };

      // O agente pode ficar minutos calado. CDN e proxy matam stream ocioso, e
      // do lado do navegador isso aparece como "erro de rede" numa resposta que
      // estava vindo bem. Um comentário SSE a cada 10s mantém o cano quente.
      const heartbeat = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          open = false;
        }
      }, 10_000);

      // A resposta ganha linha ANTES de existir. É o que a torna um trabalho da
      // conversa em vez de um resultado desta requisição: se esta função morrer
      // agora, a linha continua aqui esperando o worker, e a leitura da conversa
      // a preenche depois (settlePendingMessages).
      const assistantMessage = await prisma.chatMessage.create({
        data: { conversationId: conv.id, role: "assistant", content: "", status: "pending" },
      });

      send("start", {
        conversationId: conv.id,
        title: conv.title,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        attachments: prompted.map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          inlined: a.text !== null,
        })),
      });

      let text = "";
      try {
        text = await callOpenClawStream(prompt, s.project.agent.id, {
          project: s.project,
          sessionSuffix: conv.sessionKey,
          timeoutMs: heavy ? HEAVY_TIMEOUT_MS : LIGHT_TIMEOUT_MS,
          onJobId: (jobId) => {
            send("job", { jobId });
            // Amarra a linha ao job: é por aqui que a resposta é reencontrada
            // depois, sem o navegador ter participado.
            void prisma.chatMessage
              .update({ where: { id: assistantMessage.id }, data: { agentJobId: jobId } })
              .catch(() => {});
          },
          onDelta: (chunk) => {
            text += chunk;
            send("delta", { chunk });
          },
          onReset: (full) => {
            // O worker recomeçou a resposta. Manda substituir em vez de emendar.
            text = full;
            send("reset", { text: full });
          },
        });

        await prisma.chatMessage.update({
          where: { id: assistantMessage.id },
          data: { content: sanitizeForDb(text), status: "done", error: null },
        });
        await prisma.chatConversation.update({
          where: { id: conv.id },
          data: { updatedAt: new Date() },
        });
        send("final", { messageId: assistantMessage.id, content: text });
      } catch (err) {
        // O TETO DA FUNÇÃO NÃO É UMA FALHA DO AGENTE.
        //
        // Este é o bug que motivou tudo isto: dois turnos foram marcados como
        // erro enquanto o worker os completava (549s e 293s, respostas de 986 e
        // 1350 chars, jogadas fora). Aqui o turno fica PENDENTE, ligado ao job,
        // e quem terminar de ler a conversa depois encontra a resposta pronta.
        if (err instanceof WorkerStillRunningError) {
          await prisma.chatMessage
            .update({
              where: { id: assistantMessage.id },
              data: { content: sanitizeForDb(err.partial || text), status: "pending" },
            })
            .catch(() => {});
          send("pending", {
            messageId: assistantMessage.id,
            jobId: err.jobId,
            partial: err.partial || text,
          });
        } else {
          const error =
            err instanceof Error && err.message ? err.message : "O agente não respondeu.";
          // Falha de verdade: o que já chegou fica gravado, marcado com o motivo.
          // Meia resposta explicada vale mais que uma conversa com um buraco.
          await prisma.chatMessage
            .update({
              where: { id: assistantMessage.id },
              data: { content: sanitizeForDb(text), status: "error", error: error.slice(0, 500) },
            })
            .catch(() => {});
          send("error", { error, messageId: assistantMessage.id, partial: text });
        }
      } finally {
        clearInterval(heartbeat);
        if (open) {
          try {
            controller.close();
          } catch {
            // navegador já foi embora
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
