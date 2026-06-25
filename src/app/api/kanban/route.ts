import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject, getAllProjects } from "@/projects";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize, verifySession } from "@/lib/team-access";
import {
  addItemComment,
  addDraftIssue,
  archiveItem,
  clearItemStatus,
  createRepoIssue,
  convertDraftToIssue,
  deleteItem,
  ensureRepoLabels,
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
import { getTeamRoster } from "@/lib/team-roster";
import { getTeamMessageOptions } from "@/lib/team-messaging";
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
  const who = await authorize(token, project);
  if (!who) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [result, teamRoster, teamGithub, bountyRows] = await Promise.all([
    fetchGitHubProject(project),
    getTeamRoster(project).catch(() => []),
    teamGithubLogins(project.slug).catch(() => []),
    prisma.bounty.findMany({ where: { projectSlug: project.slug, status: { not: "cancelled" } } }).catch(() => []),
  ]);
  if (!result.ok) return NextResponse.json(result);
  const bounties = bountyRows.map((b) => ({ id: b.id, projectSlug: b.projectSlug, taskKey: b.taskKey, title: b.title, amount: b.amount, tokenSymbol: b.tokenSymbol, status: b.status, payeeAddress: b.payeeAddress, safeTxHash: b.safeTxHash }));

  // Merge portal-owned fire priority (1🔥..5🔥) onto each card.
  const itemIds = result.columns.flatMap((c) => c.items).map((i) => i.id);
  const priorityRows = itemIds.length
    ? await prisma.cardPriority.findMany({ where: { itemId: { in: itemIds } } }).catch(() => [])
    : [];
  const priorityByItem = new Map(priorityRows.map((p) => [p.itemId, p.priority]));
  for (const col of result.columns) {
    for (const it of col.items) {
      const fp = priorityByItem.get(it.id);
      if (fp) it.firePriority = fp;
    }
  }

  // Assignable users = everyone with access to the repos on the board (same
  // list GitHub's own picker offers), enriched with the portal username when
  // a team card maps the login. Team-card-only logins stay as a fallback so
  // drafts remain assignable even when the board has no repo items yet.
  const ghToken = resolveGitHubToken(project);
  const repos = [
    ...new Map(
      [
        // Configured repos — so collaborators are assignable even on a board with
        // only drafts (no issue URLs to derive a repo from), e.g. Gnars Pros.
        ...(project.repos ?? []).map((r) => r.match(/^([^/]+)\/([^/]+)$/)),
        // Repos that show up on the board's issue/PR URLs.
        ...result.columns
          .flatMap((c) => c.items)
          .map((i) => i.url?.match(/github\.com\/([^/]+)\/([^/]+)\//)),
      ]
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
  const teamMembers = teamRoster.map(({ username, avatarUrl, profileUrl, contacts, global }) => ({
    username,
    avatarUrl,
    profileUrl,
    contacts,
    global,
    messageOptions: getTeamMessageOptions(project, username, { contacts }),
  }));

  return NextResponse.json({ ...result, assignable, teamMembers, projectSlug: project.slug, canManage: who.global, bounties });
}

// ---------------------------------------------------------------------------
// POST — board mutations. Body: { action, ...args }. The GitHub token is
// resolved server-side from the active project; node ids (projectId, fieldId,
// itemId, optionId) come from the board the client already loaded via GET.
// ---------------------------------------------------------------------------

type Body = {
  action:
    | "setStatus" | "clearStatus" | "move" | "addDraft" | "addDraftAuto" | "archive" | "delete" | "setAssignees"
    | "updateContent" | "getComments" | "addComment" | "repoMeta" | "setLabels" | "ensureLabels" | "createIssue"
    | "convertDraft" | "aiBody" | "setPriority";
  /** Mutate another portal's board (SOPA aggregated view) instead of the active one. */
  targetProjectSlug?: string;
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
  // ensureLabels — create-if-missing, returns full repo label list
  wanted?: { name: string; color: string; description?: string }[];
  // setPriority — fire points 1..5 (0/absent clears)
  priority?: number;
};

export async function POST(req: Request) {
  const project = await getActiveProject();

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(sessionToken, project);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, projectId, fieldId, itemId, optionId, afterId, title, targetProjectSlug } = body;

  // Which board are we mutating? Default = the active project. The SOPA
  // aggregated board passes targetProjectSlug to move a card on ANOTHER portal's
  // board — allowed only if the viewer also has a session on that project.
  let token = resolveGitHubToken(project);
  if (targetProjectSlug && targetProjectSlug !== project.slug) {
    const target = getAllProjects().find((p) => p.slug === targetProjectSlug);
    if (!target) return NextResponse.json({ ok: false, error: "Unknown target project" }, { status: 400 });
    const allowed = await verifySession(sessionToken, target);
    if (!allowed) return NextResponse.json({ ok: false, error: "Not authorized for that project" }, { status: 403 });
    token = resolveGitHubToken(target);
  }
  if (!token) {
    return NextResponse.json({ ok: false, error: "GITHUB_TOKEN not set" }, { status: 500 });
  }

  // addDraftAuto: create a draft card WITHOUT a client-supplied projectId — we
  // resolve the board node id server-side. Used by surfaces that don't load the
  // board first (e.g. the floating chat parking a failed task for a human).
  if (action === "addDraftAuto") {
    if (!title?.trim()) {
      return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    }
    const board = await fetchGitHubProject(project);
    if (!board.ok) {
      return NextResponse.json({ ok: false, error: board.error }, { status: 400 });
    }
    const result = await addDraftIssue({
      token,
      projectId: board.projectId,
      title: title.trim(),
      body: body.body,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  // Fire priority (1🔥..5🔥) is portal-owned (DB), so it needs no GitHub token,
  // projectId, or even a real card — works on drafts too.
  if (action === "setPriority") {
    if (!itemId) return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
    const p = Math.round(Number(body.priority));
    if (!p || p < 1 || p > 5) {
      await prisma.cardPriority.deleteMany({ where: { itemId } }).catch(() => {});
      return NextResponse.json({ ok: true, priority: null });
    }
    await prisma.cardPriority.upsert({
      where: { itemId },
      create: { itemId, priority: p, projectSlug: targetProjectSlug ?? project.slug, updatedBy: session.username },
      update: { priority: p, updatedBy: session.username },
    });
    return NextResponse.json({ ok: true, priority: p });
  }

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
    case "ensureLabels": {
      const [owner, name] = (body.repo ?? "").split("/");
      if (!owner || !name || !Array.isArray(body.wanted) || body.wanted.length === 0)
        return NextResponse.json({ ok: false, error: "repo + wanted[] required" }, { status: 400 });
      result = await ensureRepoLabels({ token, owner, name, wanted: body.wanted });
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
    case "convertDraft": {
      const [owner, name] = (body.repo ?? "").split("/");
      if (!itemId || !owner || !name)
        return NextResponse.json({ ok: false, error: "itemId + repo (owner/name) required" }, { status: 400 });
      const meta = await fetchRepoMeta(token, owner, name);
      if (!meta.ok) { result = meta; break; }
      result = await convertDraftToIssue({ token, itemId, repoId: meta.repoId });
      break;
    }
    case "aiBody": {
      // Draft or improve a card body with the project's agent. `title` is the
      // card title; `body.body` carries the current body (may be empty).
      if (!title?.trim())
        return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
      const { callOpenClaw } = await import("@/lib/openclaw-gateway");
      const current = (body.body ?? "").trim();
      const prompt = [
        `You help maintain the ${project.name} GitHub project board.`,
        `Write the body for this card in GitHub-flavored markdown.`,
        ``,
        `Title: ${title.trim()}`,
        current
          ? `Current body (improve it — keep its intent and every concrete detail, tighten the rest):\n${current.slice(0, 4000)}`
          : `The card has no body yet — draft one from the title.`,
        ``,
        `Structure: one short context paragraph, then "## Acceptance criteria" as bullets; add a "## Tasks" checklist only when the work clearly splits into steps. Be specific and concise — do not invent requirements beyond what the title and current body imply.`,
        `Reply with ONLY the markdown body — no preamble, no surrounding code fence.`,
      ].join("\n");
      try {
        const generated = await callOpenClaw(prompt, project.agent.id, {
          project,
          timeoutMs: 180_000,
        });
        result = generated.trim()
          ? { ok: true as const, body: generated.trim() }
          : { ok: false as const, error: "Agent returned an empty body" };
      } catch (err) {
        result = {
          ok: false as const,
          error: err instanceof Error ? err.message : "Agent unavailable",
        };
      }
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
