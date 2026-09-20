import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/api-tokens";
import { describeTools } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/tools — as mesmas ferramentas do MCP, para quem prefere REST.
export async function GET(req: Request) {
  const bearer = await verifyBearer(req.headers.get("authorization"));
  if (!bearer) return NextResponse.json({ ok: false, error: "Unauthorized: Authorization: Bearer <token>" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="sopa-portal"' } });
  return NextResponse.json({ ok: true, user: bearer.username, tools: describeTools(bearer), usage: "POST /api/v1/tools/<name> with the arguments as a JSON body", startWith: "POST /api/v1/tools/get_guide — your projects, the tools by family and ready-made requests" });
}
