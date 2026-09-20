import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/api-tokens";
import { openApiFor } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/openapi.json — o espelho REST descrito em OpenAPI 3.1, para o
// harness que importa especificação em vez de falar MCP. Pede o mesmo Bearer:
// o catálogo de uma API interna não fica aberto na internet.
export async function GET(req: Request) {
  const bearer = await verifyBearer(req.headers.get("authorization"));
  if (!bearer) return NextResponse.json({ ok: false, error: "Unauthorized: Authorization: Bearer <token>" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="sopa-portal"' } });
  return NextResponse.json(openApiFor(new URL(req.url).origin, bearer.scopes.includes("agents")));
}
