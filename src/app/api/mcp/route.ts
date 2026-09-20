import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/api-tokens";
import { callTool, describeTools, ToolError } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// `ask_agent` espera o agente responder; o resto volta em segundos.
export const maxDuration = 300;

// Servidor MCP do portal (transporte Streamable HTTP, sem estado).
//
// Um POST = uma mensagem JSON-RPC (ou um lote), respondida em JSON comum: o
// transporte permite, e dispensa manter SSE aberto numa função serverless. O
// GET, que abriria o stream do servidor para o cliente, responde 405 — também
// previsto na especificação para servidor que não empurra nada.
//
// Autenticação: `Authorization: Bearer sopa_pat_…`, o token pessoal criado em
// Settings → API & MCP. O porteiro de sessão (proxy.ts) deixa esta rota passar
// justamente porque ela se autentica aqui dentro.

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "sopa-portal", title: "SOPA Portal", version: "1.0.0" };
const INSTRUCTIONS =
  "Context about SOPA (a crypto-native agency) and the projects it runs — SkateHive, Gnars, swaps.pro and others: briefings, kanban boards, treasury, costs, team, campaigns and the agents' own notes. Start with whoami or list_projects; every other tool takes a project slug. Everything is read-only except ask_agent, which spends model budget and is capped per day.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: Rpc["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, bearer: NonNullable<Awaited<ReturnType<typeof verifyBearer>>>) {
  // Notificação (sem id) não tem resposta.
  if (msg.id === undefined || msg.id === null) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return result(msg.id, { protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: describeTools(bearer) });
    case "resources/list":
      return result(msg.id, { resources: [] });
    case "resources/templates/list":
      return result(msg.id, { resourceTemplates: [] });
    case "prompts/list":
      return result(msg.id, { prompts: [] });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const value = await callTool(bearer, name, msg.params?.arguments);
        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        return result(msg.id, { content: [{ type: "text", text }], isError: false });
      } catch (err) {
        // Erro de USO volta como resultado com isError (o modelo lê e corrige);
        // erro nosso também, mas sem vazar detalhe interno.
        const text = err instanceof ToolError ? err.message : `Tool "${name}" failed: ${err instanceof Error ? err.message.slice(0, 200) : "internal error"}`;
        return result(msg.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return failure(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const bearer = await verifyBearer(req.headers.get("authorization"));
  if (!bearer) {
    return NextResponse.json(failure(null, -32001, "Unauthorized: send Authorization: Bearer <token> (create one in the portal, Settings → API & MCP)."), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="sopa-portal"' },
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(failure(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as Rpc, bearer)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body as Rpc, bearer);
  return out ? NextResponse.json(out) : new Response(null, { status: 202 });
}

// Sem stream do servidor para o cliente: 405, como a especificação prevê.
export async function GET() {
  return new Response("This MCP endpoint answers POST (Streamable HTTP, JSON responses).", { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
