import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  addItemComment,
  addDraftIssue,
  archiveItem,
  clearItemStatus,
  createRepoIssue,
  deleteItem,
  fetchAssignableUsers,
  fetchGitHubProject,
  fetchItemComments,
  fetchRepoMeta,
  moveItemPosition,
  resolveGitHubToken,
  resolveUserIds,
  setDraftAssignees,
  setIssueAssignees,
  setItemLabels,
  setItemStatus,
  updateItemContent,
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
  if (!result.ok) return NextResponse.json(result);

  // Assignable users = everyone with access to the repos on the board (same
  // list GitHub's own picker offers), enriched with the portal username when
  // a team card maps the login. Team-card-only logins stay as a fallback so
  // drafts remain assignable even when the board has no repo items yet.
  const ghToken = resolveGitHubToken(project);
  const repos = [
    ...new Map(
      result.columns
        .flatMap((c) => c.items)
        .map((i) => i.url?.match(/github\.com\/([^/]+)\/([^/]+)\//))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [`${m[1]}/${m[2]}`.toLowerCase(), { owner: m[1], name: m[2] }]),
    ).values(),
  ];
  const collaborators = ghToken
    ? await fetchAssignableUsers(ghToken, repos).catch(() => [])
    : [];
  const usernameByLogin = new Map(teamGithub.map((t) => [t.login.toLowerCase(), t.username]));
  const byLogin = new Map<string, { login: string; avatarUrl: string; username: string | null }>();
  for (const c of collaborators) {
    byLogin.set(c.login.toLowerCase(), {
      login: c.login,
      avatarUrl: c.avatarUrl,
      username: usernameByLogin.get(c.login.toLowerCase()) ?? null,
    });
  }
  for (const t of teamGithub) {
    if (!byLogin.has(t.login.toLowerCase())) {
      byLogin.set(t.login.toLowerCase(), {
        login: t.login,
        avatarUrl: `https://github.com/${encodeURIComponent(t.login)}.png?size=48`,
        username: t.username,
      });
    }
  }
  // Mapped teammates first, then alphabetical.
  const assignable = [...byLogin.values()].sort((a, b) => {
    if (!!a.username !== !!b.username) return a.username ? -1 : 1;
    return a.login.localeCompare(b.login);
  });

  return NextResponse.json({ ...result, assignable });
}

// ---------------------------------------------------------------------------
// POST — board mutations. Body: { action, ...args }. The GitHub token is
// resolved server-side from the active project; node ids (projectId, fieldId,
// itemId, optionId) come from the board the client already loaded via GET.
// ---------------------------------------------------------------------------

type Body = {
  action:
    | "setStatus" | "clearStatus" | "move" | "addDraft" | "archive" | "delete" | "setAssignees"
    | "updateContent" | "getComments" | "addComment" | "repoMeta" | "setLabels" | "createIssue";
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
  // updateContent / createIssue / addComment
  newTitle?: string;
  newBody?: string;
  // repoMeta / createIssue — "owner/name"
  repo?: string;
  // setLabels
  addLabelIds?: string[];
  removeLabelIds?: string[];
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
    case "updateContent": {
      const { contentId, itemType, newTitle, newBody } = body;
      if (!contentId || !itemType || !newTitle?.trim())
        return NextResponse.json({ ok: false, error: "contentId, itemType, newTitle required" }, { status: 400 });
      result = await updateItemContent({
        token,
        type: itemType,
        contentId,
        title: newTitle.trim(),
        body: newBody ?? "",
      });
      break;
    }
    case "getComments": {
      if (!body.contentId)
        return NextResponse.json({ ok: false, error: "contentId required" }, { status: 400 });
      result = await fetchItemComments(token, body.contentId);
      break;
    }
    case "addComment": {
      if (!body.contentId || !body.newBody?.trim())
        return NextResponse.json({ ok: false, error: "contentId, newBody required" }, { status: 400 });
      result = await addItemComment({ token, contentId: body.contentId, body: body.newBody.trim() });
      break;
    }
    case "repoMeta": {
      const [owner, name] = (body.repo ?? "").split("/");
      if (!owner || !name)
        return NextResponse.json({ ok: false, error: "repo (owner/name) required" }, { status: 400 });
      result = await fetchRepoMeta(token, owner, name);
      break;
    }
    case "setLabels": {
      if (!body.contentId)
        return NextResponse.json({ ok: false, error: "contentId required" }, { status: 400 });
      result = await setItemLabels({
        token,
        contentId: body.contentId,
        addIds: body.addLabelIds ?? [],
        removeIds: body.removeLabelIds ?? [],
      });
      break;
    }
    case "createIssue": {
      const [owner, name] = (body.repo ?? "").split("/");
      if (!owner || !name || !body.newTitle?.trim())
        return NextResponse.json({ ok: false, error: "repo, newTitle required" }, { status: 400 });
      const meta = await fetchRepoMeta(token, owner, name);
      if (!meta.ok) { result = meta; break; }
      result = await createRepoIssue({
        token,
        projectId,
        repoId: meta.repoId,
        title: body.newTitle.trim(),
        body: body.newBody,
      });
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
