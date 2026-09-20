import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/api-tokens";
import { callTool, describeTools, guideFor, instructionsFor, projectsForBearer, ToolError } from "@/lib/mcp/tools";
import { PROMPTS } from "@/lib/mcp/guide";

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
// As instruções da conexão são montadas por pessoa (`instructionsFor`): o modelo
// já chega sabendo quem está do outro lado e quais projetos existem. O MCP não
// tem mensagem de boas-vindas para o USUÁRIO; o que chega até ele são os prompts
// abaixo, que o cliente mostra como comandos ("/mcp__sopa__comecar" no Claude
// Code, o menu "+" no Claude Desktop).
const CAPABILITIES = { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } };
const GUIDE_URI = "sopa://guide";
const projectUri = (slug: string) => `sopa://project/${slug}`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: Rpc["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, bearer: NonNullable<Awaited<ReturnType<typeof verifyBearer>>>) {
  // Notificação (sem id) não tem resposta.
  if (msg.id === undefined || msg.id === null) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return result(msg.id, { protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0], capabilities: CAPABILITIES, serverInfo: SERVER, instructions: await instructionsFor(bearer) });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: describeTools(bearer) });
    case "resources/list": {
      const mine = await projectsForBearer(bearer);
      return result(msg.id, {
        resources: [
          { uri: GUIDE_URI, name: "guide", title: "SOPA portal: what you can ask", description: "Your projects, the tools by family, ready-made requests and the prompt shortcuts.", mimeType: "application/json" },
          ...mine.map((p) => ({ uri: projectUri(p.project.slug), name: `${p.project.slug}-overview`, title: `${p.project.name}: snapshot`, description: `Board, money, campaigns, last meeting and briefing date of ${p.project.name}.`, mimeType: "application/json" })),
        ],
      });
    }
    case "resources/templates/list":
      return result(msg.id, { resourceTemplates: [{ uriTemplate: "sopa://project/{slug}", name: "project-overview", title: "Project snapshot", description: "The get_overview of one project.", mimeType: "application/json" }] });
    case "resources/read": {
      const uri = String(msg.params?.uri ?? "");
      try {
        const slug = /^sopa:\/\/project\/([a-z0-9-]+)$/.exec(uri)?.[1];
        const value = uri === GUIDE_URI ? await guideFor(bearer, "pt") : slug ? await callTool(bearer, "get_overview", { project: slug }) : null;
        if (!value) return failure(msg.id, -32002, `Resource not found: ${uri}`);
        return result(msg.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });
      } catch (err) {
        return failure(msg.id, -32002, err instanceof ToolError ? err.message : `Could not read ${uri}`);
      }
    }
    case "prompts/list":
      return result(msg.id, { prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: `${p.description.pt} · ${p.description.en}`, arguments: p.args })) });
    case "prompts/get": {
      const prompt = PROMPTS.find((p) => p.name === String(msg.params?.name ?? ""));
      if (!prompt) return failure(msg.id, -32602, `Unknown prompt: ${String(msg.params?.name ?? "")}`);
      const given = Object.fromEntries(Object.entries((msg.params?.arguments ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "").slice(0, 400)]));
      const missing = prompt.args.filter((x) => x.required && !given[x.name]?.trim()).map((x) => x.name);
      if (missing.length) return failure(msg.id, -32602, `Missing argument: ${missing.join(", ")}`);
      return result(msg.id, { description: prompt.description.pt, messages: [{ role: "user", content: { type: "text", text: prompt.text(given) } }] });
    }
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
