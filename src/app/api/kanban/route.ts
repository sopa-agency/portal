import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  fetchGitHubProject,
  resolveGitHubToken,
  setItemStatus,
  clearItemStatus,
  moveItemPosition,
  addDraftIssue,
  archiveItem,
  deleteItem,
} from "@/lib/github-project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const project = await getActiveProject();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, project);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchGitHubProject(project);
  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// POST — board mutations. Body: { action, ...args }. The GitHub token is
// resolved server-side from the active project; node ids (projectId, fieldId,
// itemId, optionId) come from the board the client already loaded via GET.
// ---------------------------------------------------------------------------

type Body = {
  action: "setStatus" | "clearStatus" | "move" | "addDraft" | "archive" | "delete";
  projectId?: string;
  fieldId?: string;
  itemId?: string;
  optionId?: string;
  afterId?: string | null;
  title?: string;
  body?: string;
};

export async function POST(req: Request) {
  const project = await getActiveProject();

  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = resolveGitHubToken(project);
  if (!token) {
    return NextResponse.json({ ok: false, error: "GITHUB_TOKEN not set" }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, projectId, fieldId, itemId, optionId, afterId, title } = body;
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
  }

  let result;
  switch (action) {
    case "setStatus":
      if (!itemId || !fieldId || !optionId)
        return NextResponse.json({ ok: false, error: "itemId, fieldId, optionId required" }, { status: 400 });
      result = await setItemStatus({ token, projectId, itemId, fieldId, optionId });
      break;
    case "clearStatus":
      if (!itemId || !fieldId)
        return NextResponse.json({ ok: false, error: "itemId, fieldId required" }, { status: 400 });
      result = await clearItemStatus({ token, projectId, itemId, fieldId });
      break;
    case "move":
      if (!itemId)
        return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
      result = await moveItemPosition({ token, projectId, itemId, afterId: afterId ?? null });
      break;
    case "addDraft":
      if (!title?.trim())
        return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
      result = await addDraftIssue({ token, projectId, title: title.trim(), body: body.body });
      break;
    case "archive":
      if (!itemId)
        return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
      result = await archiveItem({ token, projectId, itemId });
      break;
    case "delete":
      if (!itemId)
        return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
      result = await deleteItem({ token, projectId, itemId });
      break;
    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
