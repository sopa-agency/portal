import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

const MESSAGE_MAX_LENGTH = 4000;

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Poll a chat job (big-task fallback when the SSE stream drops).
export async function GET(req: Request): Promise<Response> {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const jobId = new URL(req.url).searchParams.get("job") ?? "";
  if (!jobId) return NextResponse.json({ ok: false, error: "job required" }, { status: 400 });
  const job = await prisma.chatJob.findUnique({ where: { id: jobId } });
  if (!job || job.projectSlug !== project.slug) {
    return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    status: job.status,
    reply: job.reply ?? null,
    error: job.error ?? null,
  });
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
  let history: { role: string; text: string }[] = [];
  try {
    const body = (await req.json()) as {
      message?: unknown;
      context?: unknown;
      sessionId?: unknown;
      history?: unknown;
    };
    message = typeof body.message === "string" ? body.message.trim() : "";
    context = typeof body.context === "string" ? body.context.trim() : "";
    sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (Array.isArray(body.history)) {
      history = body.history
        .filter(
          (m): m is { role: string; text: string } =>
            !!m &&
            typeof (m as { role?: unknown }).role === "string" &&
            ["user", "assistant"].includes((m as { role: string }).role) &&
            typeof (m as { text?: unknown }).text === "string",
        )
        .slice(-12)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 700) }));
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ ok: false, error: "Message is required." }, { status: 400 });
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ ok: false, error: "Message too long." }, { status: 400 });
  }

  // Per-conversation gateway thread: without this every user shared ONE agent
  // session per project, so conversations interleaved and context was lost.
  const sessionSuffix = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || undefined;

  // -------------------------------------------------------------------------
  // Build prompt — who is talking, what was said so far, then the message.
  // -------------------------------------------------------------------------
  const headerLine = `[Portal: ${project.name} — agent ${project.agent.id}]\n[You are talking to @${session.username}, a logged-in ${project.name} portal teammate. Address them directly and keep continuity with the conversation below.]`;
  const contextBlock = context ? `\n\n${context}` : "";
  const transcript =
    history.length > 0
      ? `\n\n[Conversation so far]\n${history
          .map((m) => `${m.role === "user" ? `@${session.username}` : "you"}: ${m.text}`)
          .join("\n")}`
      : "";
  const prompt = `${headerLine}${contextBlock}${transcript}\n\n[New message from @${session.username}]\n${message}`;

  // -------------------------------------------------------------------------
  // SSE streaming path
  // -------------------------------------------------------------------------
  const url = new URL(req.url);
  if (url.searchParams.get("stream") === "1") {
    // Big-task safety net: the reply also lands in this job row, so if the
    // stream dies (proxy timeout, laptop lid, deploy) the client polls it.
    const job = await prisma.chatJob
      .create({ data: { projectSlug: project.slug, sessionId: sessionSuffix ?? "" } })
      .catch(() => null);
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

        // Heartbeat: the agent can take minutes (e.g. code changes), during
        // which we'd otherwise send zero bytes — and CDNs/proxies kill idle
        // streamed responses, surfacing on the client as "network error" /
        // "operation aborted". An SSE comment line every 10s keeps the
        // connection warm without affecting the parsed event stream.
        const heartbeat = setInterval(() => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            clientConnected = false;
          }
        }, 10_000);

        try {
          if (job) send("job", { jobId: job.id });
          send("status", { message: "pensando..." });
          const reply = await callOpenClaw(prompt, project.agent.id, {
            project,
            timeoutMs: 590_000,
            sessionSuffix,
          });
          if (job) {
            await prisma.chatJob
              .update({ where: { id: job.id }, data: { status: "done", reply } })
              .catch(() => {});
          }
          send("final", { ok: true, reply, sessionId });
        } catch (err) {
          const error =
            err instanceof Error && err.message
              ? err.message
              : "O agente não respondeu agora.";
          if (job) {
            await prisma.chatJob
              .update({ where: { id: job.id }, data: { status: "error", error } })
              .catch(() => {});
          }
          send("error", { error });
        } finally {
          clearInterval(heartbeat);
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
      sessionSuffix,
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
