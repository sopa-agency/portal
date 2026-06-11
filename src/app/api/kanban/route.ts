import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  fetchGitHubProject,
  resolveGitHubToken,
  resolveUserIds,
  setItemStatus,
  clearItemStatus,
  moveItemPosition,
  addDraftIssue,
  archiveItem,
  deleteItem,
  setIssueAssignees,
  setDraftAssignees,
} from "@/lib/github-project";
import { prisma } from "@/lib/prisma";

/** Strip "@", full profile URLs, and whitespace from a stored GitHub contact value. */
function normalizeGithubLogin(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .trim();
}

/** Portal-username → GitHub-login mapping from the team cards' GitHub contacts. */
async function teamGithubLogins(projectSlug: string): Promise<{ username: string; login: string }[]> {
  const rows = await prisma.teamMemberContact.findMany({
    where: { projectSlug, label: "GitHub" },
    select: { username: true, value: true },
  });
  const seen = new Set<string>();
  const out: { username: string; login: string }[] = [];
  for (const r of rows) {
    const login = normalizeGithubLogin(r.value);
    if (!login || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    out.push({ username: r.username, login });
  }
  return out;
}

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

  const [result, teamGithub] = await Promise.all([
    fetchGitHubProject(project),
    teamGithubLogins(project.slug).catch(() => []),
  ]);
  return NextResponse.json(result.ok ? { ...result, teamGithub } : result);
}

// ---------------------------------------------------------------------------
// POST — board mutations. Body: { action, ...args }. The GitHub token is
// resolved server-side from the active project; node ids (projectId, fieldId,
// itemId, optionId) come from the board the client already loaded via GET.
// ---------------------------------------------------------------------------

type Body = {
  action: "setStatus" | "clearStatus" | "move" | "addDraft" | "archive" | "delete" | "setAssignees";
  projectId?: string;
  fieldId?: string;
  itemId?: string;
  optionId?: string;
  afterId?: string | null;
  title?: string;
  body?: string;
  // setAssignees
  contentId?: string;
  itemType?: "issue" | "pr" | "draft";
  /** Desired final assignee set (GitHub logins). */
  logins?: string[];
  /** Assignees currently on the item — used to diff add/remove for issues/PRs. */
  currentLogins?: string[];
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
    case "setAssignees": {
      const { contentId, itemType, logins, currentLogins } = body;
      if (!contentId || !itemType || !Array.isArray(logins))
        return NextResponse.json(
          { ok: false, error: "contentId, itemType, logins required" },
          { status: 400 },
        );
      const desired = [...new Set(logins.map((l) => l.toLowerCase()))];
      const current = [...new Set((currentLogins ?? []).map((l) => l.toLowerCase()))];
      const ids = await resolveUserIds(token, [...desired, ...current]);
      const missing = desired.filter((l) => !ids[l]);
      if (missing.length > 0)
        return NextResponse.json(
          { ok: false, error: `Unknown GitHub user(s): ${missing.join(", ")}` },
          { status: 400 },
        );
      if (itemType === "draft") {
        result = await setDraftAssignees({
          token,
          draftId: contentId,
          assigneeIds: desired.map((l) => ids[l]),
        });
      } else {
        const addIds = desired.filter((l) => !current.includes(l)).map((l) => ids[l]);
        const removeIds = current.filter((l) => !desired.includes(l) && ids[l]).map((l) => ids[l]);
        result = await setIssueAssignees({ token, contentId, addIds, removeIds });
      }
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
