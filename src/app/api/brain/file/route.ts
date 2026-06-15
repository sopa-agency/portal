import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects";
import {
  deleteBrainFile,
  isProtectedBrainFile,
  readBrainFile,
  resolveSafePath,
  workspaceForProject,
  writeBrainFile,
} from "@/lib/brain-workspace";
import type { ProjectConfig } from "@/projects/types";

export const runtime = "nodejs";

async function authedProject(): Promise<ProjectConfig | null> {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  return session ? project : null;
}

// GET /api/brain/file?file=<relative path> — read one file in the active
// project's agent workspace.
export async function GET(req: Request) {
  const project = await authedProject();
  if (!project) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const file = new URL(req.url).searchParams.get("file") ?? "";
  const workspace = workspaceForProject(project);
  const abs = resolveSafePath(workspace, file);
  if (!abs) return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });

  try {
    const data = await readBrainFile(abs);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}

// POST /api/brain/file { file, content } — save edits to one file.
export async function POST(req: Request) {
  const project = await authedProject();
  if (!project) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { file?: string; content?: string } | null;
  const file = typeof body?.file === "string" ? body.file : "";
  const content = typeof body?.content === "string" ? body.content : null;
  if (content === null) {
    return NextResponse.json({ ok: false, error: "Missing content" }, { status: 400 });
  }

  const workspace = workspaceForProject(project);
  const abs = resolveSafePath(workspace, file);
  if (!abs) return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });

  try {
    await writeBrainFile(abs, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// DELETE /api/brain/file { file } — delete one file in the active project's
// agent workspace.
export async function DELETE(req: Request) {
  const project = await authedProject();
  if (!project) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { file?: string } | null;
  const file = typeof body?.file === "string" ? body.file : "";

  const workspace = workspaceForProject(project);
  const abs = resolveSafePath(workspace, file);
  if (!abs) return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });

  if (isProtectedBrainFile(file)) {
    return NextResponse.json(
      { ok: false, error: "This is a protected boot file and cannot be deleted." },
      { status: 403 },
    );
  }

  try {
    await deleteBrainFile(abs);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
