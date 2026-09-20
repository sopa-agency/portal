import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/api-tokens";
import { callTool, ToolError } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/v1/tools/<name> — corpo JSON = argumentos da ferramenta.
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const bearer = await verifyBearer(req.headers.get("authorization"));
  if (!bearer) return NextResponse.json({ ok: false, error: "Unauthorized: Authorization: Bearer <token>" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="sopa-portal"' } });
  const { name } = await ctx.params;
  const args = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ ok: true, result: await callTool(bearer, name, args) });
  } catch (err) {
    if (err instanceof ToolError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
