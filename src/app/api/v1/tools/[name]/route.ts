import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/api-tokens";
import { argsFromQuery, callTool, isReadTool, ToolError } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UNAUTHORIZED = () => NextResponse.json({ ok: false, error: "Unauthorized: Authorization: Bearer <token>" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="sopa-portal"' } });

async function run(bearer: NonNullable<Awaited<ReturnType<typeof verifyBearer>>>, name: string, args: unknown) {
  try {
    return NextResponse.json({ ok: true, result: await callTool(bearer, name, args) });
  } catch (err) {
    if (err instanceof ToolError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

// GET /api/v1/tools/<name>?project=sopa&status=Ready — só para LEITURA. Quem
// grava ou gasta modelo responde 405: GET tem de ser seguro de repetir, de
// prefetch e de cair em log de proxy.
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const bearer = await verifyBearer(req.headers.get("authorization"));
  if (!bearer) return UNAUTHORIZED();
  const { name } = await ctx.params;
  if (!isReadTool(name)) return NextResponse.json({ ok: false, error: `"${name}" is not a read tool: call it with POST.` }, { status: 405, headers: { Allow: "POST" } });
  return run(bearer, name, argsFromQuery(name, new URL(req.url).searchParams));
}

// POST /api/v1/tools/<name> — corpo JSON = argumentos da ferramenta. Vale para
// todas: leitura, escrita e ask_agent.
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const bearer = await verifyBearer(req.headers.get("authorization"));
  if (!bearer) return UNAUTHORIZED();
  const { name } = await ctx.params;
  return run(bearer, name, await req.json().catch(() => ({})));
}
