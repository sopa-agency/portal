import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { callOpenClawStream } from "@/lib/openclaw-gateway";
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
  const header =
    `[Portal: ${s.project.name} — agent ${s.project.agent.id}]\n` +
    `[Você está no CHAT do portal, falando com @${s.username}, do time. ` +
    `Responda em markdown quando ajudar: título, lista, bloco de código com a linguagem.]`;
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

      send("start", {
        conversationId: conv.id,
        title: conv.title,
        userMessageId: userMessage.id,
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
          onJobId: (jobId) => send("job", { jobId }),
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

        const saved = await prisma.chatMessage.create({
          data: {
            conversationId: conv.id,
            role: "assistant",
            content: sanitizeForDb(text),
          },
        });
        await prisma.chatConversation.update({
          where: { id: conv.id },
          data: { updatedAt: new Date() },
        });
        send("final", { messageId: saved.id, content: text });
      } catch (err) {
        const error = err instanceof Error && err.message ? err.message : "O agente não respondeu.";
        // O que já chegou não se joga fora: fica gravado, marcado com o erro.
        // Meia resposta explicada vale mais que uma conversa com um buraco.
        const saved = await prisma.chatMessage
          .create({
            data: {
              conversationId: conv.id,
              role: "assistant",
              content: sanitizeForDb(text),
              error: error.slice(0, 500),
            },
          })
          .catch(() => null);
        send("error", { error, messageId: saved?.id ?? null, partial: text });
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
