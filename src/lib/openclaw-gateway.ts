// OpenClaw gateway client — multi-tenant aware.
//
// Two transports:
//   - LOCAL (dev, on the Mac mini): plain HTTP /v1/responses against 127.0.0.1
//     using the loopback GATEWAY_TOKEN from ~/.openclaw/.env.
//   - PROD (Vercel): device-signed WebSocket handshake against the public
//     Tailscale Funnel URL.
//
// callOpenClaw(prompt, agentId, opts) auto-selects based on which env vars are
// set. Pass `project` to use namespaced env vars (SKATEHIVE_GATEWAY_URL etc.).
// When project is omitted the legacy globals are read directly (backward compat).

import { createPrivateKey, sign } from "node:crypto";
import WebSocket from "ws";
import type { ProjectConfig } from "@/projects/types";
import { projectEnv } from "@/projects/secrets";
import { sanitizeForDb } from "@/lib/sanitize";

// The `ws` library dispatches an `ErrorEvent` when a socket errors. That global
// isn't defined in Vercel's serverless runtime, so an errored WS connection
// threw an uncaught `ReferenceError: ErrorEvent is not defined` and KILLED the
// function (exit 129) — surfacing as the briefing/chat failures. Shim it so a
// WS error becomes a catchable rejection instead of a fatal crash.
{
  const g = globalThis as Record<string, unknown>;
  if (typeof g.ErrorEvent === "undefined") {
    g.ErrorEvent = class ErrorEvent {
      type: string;
      error: unknown;
      message: string;
      constructor(type: string, init?: { error?: unknown; message?: string }) {
        this.type = type;
        this.error = init?.error;
        this.message = init?.message ?? "";
      }
    };
  }
}

const WS_CONNECT_TIMEOUT_MS = 20_000; // cross-region funnel connects can be slow
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

type GatewayFrame = {
  type?: string;
  event?: string;
  id?: string;
  ok?: boolean;
  payload?: unknown;
  error?: { message?: string };
};

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function trimmed(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** Read a gateway env var, preferring project-namespaced key, falling back to legacy global. */
function gatewayEnv(key: string, project?: ProjectConfig): string | null {
  if (project) {
    const val = projectEnv(project, key);
    return val ?? null;
  }
  // Legacy path: read global names as before.
  return trimmed(key);
}

function resolveGatewayWsUrl(gatewayUrl: string) {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function buildSignedDevice(token: string, nonce: string, project?: ProjectConfig) {
  const deviceId = gatewayEnv("PORTAL_DEVICE_ID", project) ?? trimmed("OPENCLAW_PORTAL_DEVICE_ID");
  const publicKey = gatewayEnv("PORTAL_DEVICE_PUBLIC_KEY", project) ?? trimmed("OPENCLAW_PORTAL_DEVICE_PUBLIC_KEY");
  const privateKeyBase64 = gatewayEnv("PORTAL_DEVICE_PRIVATE_KEY_BASE64", project) ?? trimmed("OPENCLAW_PORTAL_DEVICE_PRIVATE_KEY_BASE64");
  if (!deviceId || !publicKey || !privateKeyBase64) {
    throw new Error(
      "Device-signed gateway not configured. Missing PORTAL_DEVICE_ID / PUBLIC_KEY / PRIVATE_KEY_BASE64.",
    );
  }

  const signedAt = Date.now();
  const payload = [
    "v3",
    deviceId,
    "gateway-client",
    "backend",
    "operator",
    "operator.read,operator.write",
    String(signedAt),
    token,
    nonce,
    "node",
    "",
  ].join("|");

  const privateKeyPem = Buffer.from(privateKeyBase64, "base64").toString("utf8");
  const privateKey = createPrivateKey(privateKeyPem);

  return {
    id: deviceId,
    publicKey,
    signature: base64Url(sign(null, Buffer.from(payload, "utf8"), privateKey)),
    signedAt,
    nonce,
  };
}

function normalizeAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown; text?: unknown };
  if (typeof m.text === "string") return m.text;
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const p = part as { text?: unknown; type?: unknown };
        if (p.type === "text" && typeof p.text === "string") return p.text;
        if (typeof p.text === "string") return p.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// HTTP /v1/responses path — used by the worker on the Mac mini against the
// loopback gateway.
async function callOverHttp(
  prompt: string,
  agentId: string,
  opts: { timeoutMs?: number; project?: ProjectConfig } = {},
): Promise<string> {
  const url =
    (opts.project ? projectEnv(opts.project, "GATEWAY_URL") : null) ??
    trimmed("OPENCLAW_GATEWAY_URL") ??
    "http://127.0.0.1:18789";
  const token =
    (opts.project ? projectEnv(opts.project, "GATEWAY_TOKEN") : null) ??
    trimmed("OPENCLAW_GATEWAY_TOKEN") ??
    trimmed("GATEWAY_TOKEN");
  if (!token) {
    throw new Error("GATEWAY_TOKEN / OPENCLAW_GATEWAY_TOKEN not set for HTTP transport.");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: `openclaw/${agentId}`, input: prompt }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gateway HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { output?: unknown };
    const out = Array.isArray(data.output) ? data.output : [];
    const pieces: string[] = [];
    for (const msg of out) {
      const content = (msg as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if ((c as { type?: string })?.type === "output_text") {
          const t = (c as { text?: unknown }).text;
          if (typeof t === "string") pieces.push(t);
        }
      }
    }
    return pieces.join("\n").trim();
  } finally {
    clearTimeout(timer);
  }
}

// WebSocket chat.send path — used in production against the Tailscale Funnel
// URL, authenticated by Ed25519 device signature.
async function callOverWs(
  prompt: string,
  agentId: string,
  opts: { timeoutMs?: number; project?: ProjectConfig; sessionSuffix?: string } = {},
): Promise<string> {
  const gatewayUrl =
    (opts.project ? projectEnv(opts.project, "GATEWAY_URL") : null) ??
    trimmed("OPENCLAW_GATEWAY_URL");
  const gatewayToken =
    (opts.project ? projectEnv(opts.project, "GATEWAY_TOKEN") : null) ??
    trimmed("GATEWAY_TOKEN");
  if (!gatewayUrl || !gatewayToken) {
    throw new Error("OPENCLAW_GATEWAY_URL and GATEWAY_TOKEN are required for WS transport.");
  }

  const wsUrl = resolveGatewayWsUrl(gatewayUrl);
  const ws = new WebSocket(wsUrl);
  const projectSlug = opts.project?.slug ?? "portal";
  // Without a suffix every caller shares ONE agent session per project —
  // users' chats would interleave. The chat route passes its per-browser
  // conversation id here so each conversation is its own thread.
  const sessionKey = `agent:${agentId}:${projectSlug}${opts.sessionSuffix ? `:${opts.sessionSuffix}` : ""}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
  const idempotencyKey = `portal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        try { ws.close(); } catch {}
        reject(new Error("Gateway WS connect timeout"));
      });
    }, WS_CONNECT_TIMEOUT_MS);

    const onMsg = (event: WebSocket.MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as GatewayFrame;
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = (frame.payload as { nonce?: string } | undefined)?.nonce ?? "";
          ws.send(
            JSON.stringify({
              type: "req",
              id: "connect",
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: { id: "gateway-client", version: "0.1.0", platform: "node", mode: "backend" },
                role: "operator",
                scopes: ["operator.read", "operator.write"],
                caps: [],
                commands: [],
                permissions: {},
                auth: { token: gatewayToken },
                device: buildSignedDevice(gatewayToken, nonce, opts.project),
              },
            }),
          );
          return;
        }
        if (frame.type === "res" && frame.id === "connect") {
          if (!frame.ok) {
            finish(() => {
              try { ws.close(); } catch {}
              reject(new Error(frame.error?.message ?? "Gateway connect failed"));
            });
            return;
          }
          ws.removeEventListener("message", onMsg);
          finish(() => resolve());
        }
      } catch (err) {
        finish(() => {
          try { ws.close(); } catch {}
          reject(err instanceof Error ? err : new Error("Invalid gateway frame"));
        });
      }
    };
    ws.addEventListener("message", onMsg);
    ws.addEventListener("error", (event) => {
      const msg = event instanceof ErrorEvent && event.message ? event.message : "Gateway WS error";
      finish(() => reject(new Error(msg)));
    });
    ws.addEventListener("close", () => {
      finish(() => reject(new Error("Gateway closed before handshake completed")));
    });
  });

  let buffer = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`Gateway prompt timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      ws.addEventListener("message", (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as {
            type?: string;
            event?: string;
            id?: string;
            ok?: boolean;
            payload?: { sessionKey?: string; state?: string; message?: unknown };
            error?: { message?: string };
          };
          if (frame.type === "res" && frame.id === "chat-send" && !frame.ok) {
            finish(() => reject(new Error(frame.error?.message ?? "chat.send failed")));
            return;
          }
          if (frame.type !== "event" || frame.event !== "chat") return;
          const payload = frame.payload;
          if (!payload || payload.sessionKey !== sessionKey) return;

          const text = normalizeAssistantText(payload.message);
          if (payload.state === "delta" && text) {
            buffer = text.startsWith(buffer) ? text : buffer + text;
          }
          if (payload.state === "final") finish(() => resolve(text || buffer));
          if (payload.state === "aborted") finish(() => reject(new Error("Gateway aborted")));
          if (payload.state === "error") finish(() => reject(new Error(text || "Gateway error")));
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error("Invalid gateway frame")));
        }
      });
      ws.addEventListener("close", () => {
        finish(() => (buffer ? resolve(buffer) : reject(new Error("Gateway closed before reply"))));
      });

      ws.send(
        JSON.stringify({
          type: "req",
          id: "chat-send",
          method: "chat.send",
          params: { sessionKey, message: prompt, idempotencyKey, timeoutMs },
        }),
      );
    });
  } finally {
    try { ws.close(1000, "prompt-complete"); } catch {}
  }
}

// Should this process reach the gateway through the DB job queue instead of
// calling it directly? Vercel (process.env.VERCEL === "1") can't reach the
// gateway over the Tailscale funnel — the TLS handshake drops — so it enqueues
// an AgentJob and waits for the Mac-mini worker (local 127.0.0.1) to fill in
// the result. The Mac itself (no VERCEL env) keeps calling the gateway directly.
// Override with OPENCLAW_TRANSPORT = "queue" | "direct".
function shouldUseQueue(): boolean {
  const t = trimmed("OPENCLAW_TRANSPORT");
  if (t === "queue") return true;
  if (t === "direct") return false;
  return !!process.env.VERCEL;
}

// Enqueue an AgentJob and poll until the Mac worker writes a result. Keeps the
// Promise<string> contract so every caller works unchanged — it just waits on
// the worker rather than the (unreachable) gateway.
async function callViaQueue(
  prompt: string,
  agentId: string,
  timeoutMs: number,
  onJobId?: (id: string) => void,
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const job = await prisma.agentJob.create({
    // Sanitize: the prompt concatenates fetched content (Hive posts, the GitHub
    // board, etc.) that can carry null bytes / lone surrogates, which Postgres
    // rejects on a text column → "Invalid `prisma.agentJob.create()` invocation".
    data: { agentSlug: agentId, prompt: sanitizeForDb(prompt), timeoutMs },
  });
  // Surface the AgentJob id so callers (the chat) can link it to a ChatJob and
  // keep polling the worker's result past the serverless function ceiling.
  onJobId?.(job.id);
  // Give the worker the job's own budget plus headroom for poll/claim latency,
  // but never exceed the serverless function ceiling.
  const deadline = Date.now() + Math.min(timeoutMs + 30_000, 290_000);
  let delay = 1_500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 4_000);
    let row;
    try {
      row = await prisma.agentJob.findUnique({ where: { id: job.id } });
    } catch {
      continue; // transient DB blip — keep polling
    }
    if (!row) continue;
    if (row.status === "done") return row.result ?? "";
    if (row.status === "error") throw new Error(row.error || "Agent job failed");
  }
  throw new Error("Agent job timed out waiting for the worker");
}

// Pick a transport. On Vercel, route through the DB job queue (the gateway is
// unreachable over the funnel). Otherwise: device keys configured => WebSocket
// signed; token => loopback/funnel HTTP (Mac mini local).
export async function callOpenClaw(
  prompt: string,
  agentId: string,
  opts: {
    timeoutMs?: number;
    project?: ProjectConfig;
    sessionSuffix?: string;
    onJobId?: (id: string) => void;
  } = {},
): Promise<string> {
  if (shouldUseQueue()) {
    return callViaQueue(prompt, agentId, opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS, opts.onJobId);
  }
  const deviceId =
    (opts.project ? projectEnv(opts.project, "PORTAL_DEVICE_ID") : null) ??
    trimmed("OPENCLAW_PORTAL_DEVICE_ID");
  const publicKey =
    (opts.project ? projectEnv(opts.project, "PORTAL_DEVICE_PUBLIC_KEY") : null) ??
    trimmed("OPENCLAW_PORTAL_DEVICE_PUBLIC_KEY");
  const privateKey =
    (opts.project ? projectEnv(opts.project, "PORTAL_DEVICE_PRIVATE_KEY_BASE64") : null) ??
    trimmed("OPENCLAW_PORTAL_DEVICE_PRIVATE_KEY_BASE64");
  const hasDeviceAuth = !!deviceId && !!publicKey && !!privateKey;
  const hasToken = !!(
    (opts.project ? projectEnv(opts.project, "GATEWAY_TOKEN") : null) ??
    trimmed("OPENCLAW_GATEWAY_TOKEN") ??
    trimmed("GATEWAY_TOKEN")
  );
  // Default to the transport that actually works: the token-auth HTTP
  // /v1/responses path is reliable over the Tailscale Funnel, while the
  // signed-WS connect is flaky from Vercel (cross-region/cold-start timeouts).
  // Lead with HTTP whenever a token exists; only fall back to signed-WS if
  // HTTP fails and device auth is configured.
  if (hasToken) {
    try {
      return await callOverHttp(prompt, agentId, opts);
    } catch (err) {
      // undici hides the real reason in err.cause (ENOTFOUND / ECONNREFUSED /
      // UND_ERR_CONNECT_TIMEOUT / TLS …) — surface it so we can see WHY Vercel
      // can't reach the funnel.
      const cause = (err as { cause?: unknown })?.cause;
      console.warn(
        `[openclaw] HTTP transport failed: ${err instanceof Error ? err.message : err} | cause: ${
          cause instanceof Error ? `${cause.name}: ${cause.message}` : JSON.stringify(cause)
        }`,
      );
      if (!hasDeviceAuth) throw err;
      console.warn("[openclaw] falling back to signed WS.");
      return callOverWs(prompt, agentId, opts);
    }
  }
  // No token — signed WS is the only option (or HTTP surfaces the clean
  // "token missing" error when neither is configured).
  return hasDeviceAuth ? callOverWs(prompt, agentId, opts) : callOverHttp(prompt, agentId, opts);
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
//
// O gateway FALA streaming: com `stream: true` o /v1/responses devolve SSE com
// eventos `response.output_text.delta`. Verificado contra o gateway local.
//
// O problema nunca foi o gateway, foi o caminho: na Vercel a chamada passa pelo
// queue (o funnel nao fecha TLS de la), e queue e uma linha de banco — nao tem
// canal para pedaco de texto. Por isso o AgentJob ganhou a coluna `partial`: o
// worker escreve o texto crescendo e aqui a gente le o crescimento e emite a
// diferenca. Quem chama recebe deltas dos dois lados sem saber por onde veio.
//
// Nenhum caminho e "quase streaming": quando nao ha delta possivel, a resposta
// vem inteira de uma vez e a interface mostra isso. Nao simulamos digitacao
// para fingir algo que nao aconteceu.

export type OpenClawStreamOpts = {
  timeoutMs?: number;
  project?: ProjectConfig;
  sessionSuffix?: string;
  /** Recebe cada pedaco NOVO de texto, na ordem. */
  onDelta?: (chunk: string) => void;
  /** Chamado quando o texto ja entregue foi invalidado — ver streamViaQueue. */
  onReset?: (full: string) => void;
  /** Id do AgentJob, quando o transporte e o queue — deixa o cliente retomar. */
  onJobId?: (id: string) => void;
};

/** Le um corpo SSE e chama onEvent para cada bloco `event:`/`data:`. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() || "message";
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        onEvent(event, JSON.parse(dataLine.slice(5).trim()));
      } catch {
        // bloco parcial ou nao-JSON — ignora; o proximo chega inteiro
      }
    }
  }
}

/** Caminho direto (Mac): SSE do gateway, delta a delta. */
async function streamOverHttp(
  prompt: string,
  agentId: string,
  opts: OpenClawStreamOpts,
): Promise<string> {
  const url =
    (opts.project ? projectEnv(opts.project, "GATEWAY_URL") : null) ??
    trimmed("OPENCLAW_GATEWAY_URL") ??
    "http://127.0.0.1:18789";
  const token =
    (opts.project ? projectEnv(opts.project, "GATEWAY_TOKEN") : null) ??
    trimmed("OPENCLAW_GATEWAY_TOKEN") ??
    trimmed("GATEWAY_TOKEN");
  if (!token) throw new Error("GATEWAY_TOKEN / OPENCLAW_GATEWAY_TOKEN not set for HTTP transport.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: `openclaw/${agentId}`, input: prompt, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gateway HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    let full = "";
    let failure = "";
    await readSse(res.body, (event, data) => {
      const d = data as { delta?: unknown; text?: unknown; error?: { message?: string } };
      if (event === "response.output_text.delta" && typeof d.delta === "string") {
        full += d.delta;
        opts.onDelta?.(d.delta);
        return;
      }
      // O `.done` traz o texto completo do bloco. So usamos se NENHUM delta
      // veio (gateway mais antigo), senao duplicaria tudo o que ja foi entregue.
      if (event === "response.output_text.done" && typeof d.text === "string" && !full) {
        full = d.text;
        opts.onDelta?.(d.text);
        return;
      }
      if (event === "response.failed" || event === "error") {
        failure = d.error?.message || "O gateway falhou no meio da resposta.";
      }
    });
    if (failure) throw new Error(failure);
    return full.trim();
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(`OpenClaw timed out after ${opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Caminho da Vercel: enfileira e le o `partial` crescendo.
 *
 * O delta e o SUFIXO do que ja foi entregue, e so quando o texto novo comeca
 * com o antigo. Se o worker reescrever o comeco (retry do turno), isso nao e
 * continuacao: avisamos reset e mandamos o texto inteiro. Melhor a interface
 * substituir do que emendar duas respostas diferentes numa so.
 */
async function streamViaQueue(
  prompt: string,
  agentId: string,
  timeoutMs: number,
  opts: OpenClawStreamOpts,
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const job = await prisma.agentJob.create({
    data: { agentSlug: agentId, prompt: sanitizeForDb(prompt), timeoutMs },
  });
  opts.onJobId?.(job.id);

  const deadline = Date.now() + Math.min(timeoutMs + 30_000, 290_000);
  let delivered = "";
  let delay = 700;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    // Escrevendo, vale olhar de perto; parado, vale espacar.
    delay = Math.min(delay * 1.15, 2_500);
    let row;
    try {
      row = await prisma.agentJob.findUnique({ where: { id: job.id } });
    } catch {
      continue; // piscada do banco — segue tentando
    }
    if (!row) continue;

    const soFar = row.status === "done" ? (row.result ?? "") : (row.partial ?? "");
    if (soFar && soFar !== delivered) {
      if (soFar.startsWith(delivered)) {
        opts.onDelta?.(soFar.slice(delivered.length));
      } else {
        opts.onReset?.(soFar);
      }
      delivered = soFar;
      delay = 700; // voltou a escrever — volta a olhar de perto
    }

    if (row.status === "done") return (row.result ?? delivered).trim();
    if (row.status === "error") throw new Error(row.error || "Agent job failed");
  }
  throw new Error("Agent job timed out waiting for the worker");
}

/**
 * Mesma escolha de transporte do callOpenClaw, com deltas.
 *
 * Devolve o texto completo no fim — quem chama pode ignorar os deltas e usar so
 * o retorno, que e exatamente o que o caminho sem streaming sempre fez.
 */
export async function callOpenClawStream(
  prompt: string,
  agentId: string,
  opts: OpenClawStreamOpts = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
  if (shouldUseQueue()) return streamViaQueue(prompt, agentId, timeoutMs, opts);

  try {
    return await streamOverHttp(prompt, agentId, opts);
  } catch (err) {
    console.warn(
      `[openclaw] stream transport failed: ${err instanceof Error ? err.message : err}; ` +
        "caindo para a chamada sem streaming",
    );
    // Sem streaming a resposta vem inteira. Entregamos como um delta unico em
    // vez de inventar digitacao: o usuario ve a resposta aparecer de uma vez,
    // que e o que de fato aconteceu.
    const reply = await callOpenClaw(prompt, agentId, {
      timeoutMs,
      project: opts.project,
      sessionSuffix: opts.sessionSuffix,
      onJobId: opts.onJobId,
    });
    if (reply) opts.onDelta?.(reply);
    return reply;
  }
}
