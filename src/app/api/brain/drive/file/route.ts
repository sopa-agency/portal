import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";
import { getDriveFileContent } from "@/lib/google-drive";

export const runtime = "nodejs";

// GET /api/brain/drive/file?id=<fileId>[&mode=raw]
// Fetches one Drive file's content. Auth-gated.
//
// With ?mode=raw (for images and PDFs): returns the raw bytes with the
// correct Content-Type so the browser can use <img src=…> or <iframe src=…>
// directly — the Bearer token never leaves the server.
//
// Without ?mode=raw (or for kind:"html" / kind:"link"): returns JSON.
export async function GET(req: Request) {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const fileId = params.get("id") ?? "";
  const rawMode = params.get("mode") === "raw";

  if (!fileId) {
    return NextResponse.json({ ok: false, error: "Missing ?id= parameter" }, { status: 400 });
  }

  const result = await getDriveFileContent(project, fileId);

  // Error result
  if ("ok" in result && !result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  // Raw proxy mode: client asked for bytes (used for <img src=…> / <iframe src=…>)
  if (rawMode && "kind" in result && result.kind === "binary") {
    const bytes = Buffer.from(result.base64, "base64");
    return new Response(bytes, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(bytes.byteLength),
        // Allow embedding in same-origin iframe (pdf viewer, img)
        "X-Frame-Options": "SAMEORIGIN",
        // Cache 5 min on the browser side — file contents don't change frequently
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // JSON mode: return the content descriptor
  return NextResponse.json(result);
}
