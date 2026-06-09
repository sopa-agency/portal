import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects";
import { listDriveFolder } from "@/lib/google-drive";

export const runtime = "nodejs";

// GET /api/brain/drive/list[?folderId=…]
// Lists files in the active project's Google Drive folder. Auth-gated with the
// same session + active-project guard as the workspace brain routes.
export async function GET(req: Request) {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Optional ?folderId= to drill into subfolders
  const folderId = new URL(req.url).searchParams.get("folderId") ?? undefined;

  const result = await listDriveFolder(project, folderId);
  return NextResponse.json(result);
}
