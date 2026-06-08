import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects";
import { callOpenClaw } from "@/lib/openclaw-gateway";

export const runtime = "nodejs";
export const maxDuration = 300;

const MESSAGE_MAX_LENGTH = 4000;

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  // -------------------------------------------------------------------------
  // Auth backstop — verify session even though the proxy gates this too.
  // -------------------------------------------------------------------------
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // -------------------------------------------------------------------------
  // Parse JSON body
  // -------------------------------------------------------------------------
  let message = "";
  let context = "";
  let sessionId = "";
  try {
    const body = (await req.json()) as { message?: unknown; context?: unknown; sessionId?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
    context = typeof body.context === "string" ? body.context.trim() : "";
    sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ ok: false, error: "Message is required." }, { status: 400 });
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ ok: false, error: "Message too long." }, { status: 400 });
  }

  // -------------------------------------------------------------------------
  // Build prompt
  // -------------------------------------------------------------------------
  const headerLine = `[Portal: ${project.name} — agent ${project.agent.id}]`;
  const contextBlock = context ? `\n\n${context}` : "";
  const prompt = `${headerLine}${contextBlock}\n\n[User message]\n${message}`;

  // -------------------------------------------------------------------------
  // SSE streaming path
  // -------------------------------------------------------------------------
  const url = new URL(req.url);
  if (url.searchParams.get("stream") === "1") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let clientConnected = true;
        const send = (event: string, data: unknown) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode(sseEncode(event, data)));
          } catch {
            clientConnected = false;
          }
        };

        try {
          send("status", { message: "pensando..." });
          const reply = await callOpenClaw(prompt, project.agent.id, {
            project,
            timeoutMs: 290_000,
          });
          send("final", { ok: true, reply, sessionId });
        } catch (err) {
          const error =
            err instanceof Error && err.message
              ? err.message
              : "O agente não respondeu agora.";
          send("error", { error });
        } finally {
          if (clientConnected) {
            try {
              controller.close();
            } catch {
              // browser already disconnected
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

  // -------------------------------------------------------------------------
  // Non-stream fallback — plain JSON response
  // -------------------------------------------------------------------------
  try {
    const reply = await callOpenClaw(prompt, project.agent.id, {
      project,
      timeoutMs: 290_000,
    });
    return NextResponse.json({ ok: true, reply, sessionId });
  } catch (err) {
    const error =
      err instanceof Error && err.message
        ? err.message
        : "O agente não respondeu agora.";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
