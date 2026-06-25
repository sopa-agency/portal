import "server-only";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KanbanItem = {
  id: string;
  type: "issue" | "pr" | "draft";
  title: string;
  number?: number;
  url?: string;
  state?: string;
  merged?: boolean;
  /** Issue/PR/draft body, GitHub-flavored markdown. */
  body?: string;
  /** Content node id (Issue/PullRequest/DraftIssue) — needed to mutate assignees. */
  contentId: string | null;
  assignees: { login: string; avatarUrl: string }[];
  labels: { id?: string; name: string; color: string }[];
  /** Value of the board's "Priority" single-select field (e.g. "P0", "High"), if any. */
  priority?: string;
  /** Portal-owned priority points: 1🔥 (lowest) .. 5🔥 (highest). From CardPriority. */
  firePriority?: number;
  /** Portal-owned due date (ISO yyyy-mm-dd). From CardPriority. */
  deadline?: string;
};

export type KanbanColumn = {
  name: string;
  items: KanbanItem[];
  /** Status single-select option id (absent for the synthetic "No Status" column). */
  optionId?: string;
};

export type KanbanResult =
  | {
      ok: true;
      title: string;
      url: string;
      /** Project node id — needed for all mutations. */
      projectId: string;
      /** Status single-select field node id (null if the project has no Status field). */
      statusFieldId: string | null;
      columns: KanbanColumn[];
      truncated: boolean;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

const PROJECT_FRAGMENT = `
  id
  title
  url
  field(name: "Status") {
    ... on ProjectV2SingleSelectField {
      id
      options {
        id
        name
      }
    }
  }
  items(first: 100) {
    nodes {
      id
      type
      content {
        ... on Issue {
          id
          title
          number
          url
          state
          body
          assignees(first: 5) {
            nodes {
              login
              avatarUrl
            }
          }
          labels(first: 10) {
            nodes {
              id
              name
              color
            }
          }
        }
        ... on PullRequest {
          id
          title
          number
          url
          state
          body
          merged
          assignees(first: 5) {
            nodes {
              login
              avatarUrl
            }
          }
          labels(first: 10) {
            nodes {
              id
              name
              color
            }
          }
        }
        ... on DraftIssue {
          id
          title
          body
          assignees(first: 5) {
            nodes {
              login
              avatarUrl
            }
          }
        }
      }
      fieldValues(first: 20) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field {
              ... on ProjectV2SingleSelectField {
                name
              }
            }
          }
        }
      }
    }
  }
`;

const QUERY = `
  query GetProject($login: String!, $number: Int!) {
    organization(login: $login) {
      projectV2(number: $number) {
        ${PROJECT_FRAGMENT}
      }
    }
    user(login: $login) {
      projectV2(number: $number) {
        ${PROJECT_FRAGMENT}
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

/** Resolve the GitHub token for a project (project-scoped, then global). */
export function resolveGitHubToken(project: ProjectConfig): string | undefined {
  return (
    process.env[`${project.agent.gatewayEnvPrefix}_GITHUB_TOKEN`] ??
    process.env.GITHUB_TOKEN
  );
}

export async function fetchGitHubProject(project: ProjectConfig): Promise<KanbanResult> {
  const token = resolveGitHubToken(project);

  if (!token) {
    return { ok: false, error: "GITHUB_TOKEN not set" };
  }

  if (!project.githubProject) {
    return { ok: false, error: "No GitHub project configured" };
  }

  const { org, number } = project.githubProject;

  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { login: org, number },
      }),
      // Do not cache — always fetch fresh board state
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `GitHub API returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const json = await res.json() as {
      data?: {
        organization?: {
          projectV2?: {
            id: string;
            title: string;
            url: string;
            field?: {
              id?: string;
              options?: { id: string; name: string }[];
            };
            items: {
              nodes: Array<{
                id: string;
                type: string;
                content?: {
                  id?: string;
                  title?: string;
                  number?: number;
                  url?: string;
                  state?: string;
                  body?: string;
                  merged?: boolean;
                  assignees?: { nodes: { login: string; avatarUrl: string }[] };
                  labels?: { nodes: { id?: string; name: string; color: string }[] };
                };
                fieldValues: {
                  nodes: Array<{
                    name?: string;
                    field?: { name?: string };
                  }>;
                };
              }>;
            };
          };
        };
        user?: {
          projectV2?: {
            id: string;
            title: string;
            url: string;
            field?: {
              id?: string;
              options?: { id: string; name: string }[];
            };
            items: {
              nodes: Array<{
                id: string;
                type: string;
                content?: {
                  id?: string;
                  title?: string;
                  number?: number;
                  url?: string;
                  state?: string;
                  body?: string;
                  merged?: boolean;
                  assignees?: { nodes: { login: string; avatarUrl: string }[] };
                  labels?: { nodes: { id?: string; name: string; color: string }[] };
                };
                fieldValues: {
                  nodes: Array<{
                    name?: string;
                    field?: { name?: string };
                  }>;
                };
              }>;
            };
          };
        };
      };
      errors?: { message: string }[];
    };

    // The query resolves the owner as BOTH organization and user — exactly one
    // matches, and the other always errors ("Could not resolve to a User/Organization").
    // So errors are only fatal when neither half returned a project.
    const projectV2 = json.data?.organization?.projectV2 ?? json.data?.user?.projectV2;
    if (!projectV2) {
      return {
        ok: false,
        error:
          json.errors?.[0]?.message ??
          `Project #${number} not found for owner "${org}". Check that the token has project + read:org scopes.`,
      };
    }

    // Status column options (in order from GitHub)
    const statusOptions: { id: string; name: string }[] =
      projectV2.field?.options ?? [];

    // Build column map: status name -> KanbanItem[]
    const columnMap = new Map<string, KanbanItem[]>();
    for (const opt of statusOptions) {
      columnMap.set(opt.name, []);
    }

    const rawItems = projectV2.items.nodes;
    const noStatusItems: KanbanItem[] = [];

    for (const node of rawItems) {
      const content = node.content;

      // Determine type
      let type: KanbanItem["type"] = "draft";
      if (node.type === "ISSUE") type = "issue";
      else if (node.type === "PULL_REQUEST") type = "pr";
      else if (node.type === "DRAFT_ISSUE") type = "draft";

      const title = content?.title ?? "(Untitled)";
      const number = content?.number;
      const url = content?.url;
      const state = content?.state?.toLowerCase();
      const merged = content?.merged;
      const body = content?.body;
      const assignees = (content?.assignees?.nodes ?? []).map((a) => ({
        login: a.login,
        avatarUrl: a.avatarUrl,
      }));
      const labels = (content?.labels?.nodes ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color, // GitHub returns hex WITHOUT the #
      }));

      const contentId = content?.id ?? null;
      // Priority single-select value (board's "Priority" field), if the project has one.
      const priority = node.fieldValues.nodes.find(
        (fv) => fv.field?.name === "Priority" && fv.name != null,
      )?.name ?? undefined;
      const item: KanbanItem = { id: node.id, type, title, number, url, state, merged, body, contentId, assignees, labels, priority };

      // Find the Status field value for this item
      const statusValue = node.fieldValues.nodes.find(
        (fv) => fv.field?.name === "Status" && fv.name != null,
      );

      if (statusValue?.name && columnMap.has(statusValue.name)) {
        columnMap.get(statusValue.name)!.push(item);
      } else {
        noStatusItems.push(item);
      }
    }

    // Build ordered columns
    const columns: KanbanColumn[] = statusOptions.map((opt) => ({
      name: opt.name,
      optionId: opt.id,
      items: columnMap.get(opt.name) ?? [],
    }));

    // Always append a "No Status" column (the drop target for clearing status),
    // even when empty, so cards can be dragged back out of a status.
    columns.push({ name: "No Status", items: noStatusItems });

    return {
      ok: true,
      title: projectV2.title,
      url: projectV2.url,
      projectId: projectV2.id,
      statusFieldId: projectV2.field?.id ?? null,
      columns,
      truncated: rawItems.length === 100,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Unexpected error: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type MutationResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** Low-level GraphQL caller used by all mutations. */
async function githubGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<MutationResult<{ data: T }>> {
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: `GitHub API returned HTTP ${res.status}: ${res.statusText}` };
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors && json.errors.length > 0) {
      return { ok: false, error: json.errors[0].message };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Unexpected error: ${message}` };
  }
}

/** Move a card to a Status column (set the Status single-select value). */
export async function setItemStatus(args: {
  token: string;
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string;
}): Promise<MutationResult> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }`;
  return githubGraphQL(args.token, query, args);
}

/** Clear a card's Status (drag back to "No Status"). */
export async function clearItemStatus(args: {
  token: string;
  projectId: string;
  itemId: string;
  fieldId: string;
}): Promise<MutationResult> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
      clearProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId
      }) { projectV2Item { id } }
    }`;
  return githubGraphQL(args.token, query, args);
}

/** Reorder a card within the board. afterId = the item it should follow (null = top). */
export async function moveItemPosition(args: {
  token: string;
  projectId: string;
  itemId: string;
  afterId: string | null;
}): Promise<MutationResult> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!, $afterId: ID) {
      updateProjectV2ItemPosition(input: {
        projectId: $projectId, itemId: $itemId, afterId: $afterId
      }) { items { totalCount } }
    }`;
  return githubGraphQL(args.token, query, args);
}

/** Create a draft issue on the board. Returns the new item id. */
export async function addDraftIssue(args: {
  token: string;
  projectId: string;
  title: string;
  body?: string;
}): Promise<MutationResult<{ itemId: string; contentId: string | null }>> {
  // Return the DraftIssue content id too, so the caller can render an
  // immediately-editable optimistic card (description edits need contentId).
  const query = `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
        projectItem { id content { ... on DraftIssue { id } } }
      }
    }`;
  const r = await githubGraphQL<{
    addProjectV2DraftIssue: { projectItem: { id: string; content?: { id?: string } } };
  }>(args.token, query, args);
  if (!r.ok) return r;
  const pi = r.data.addProjectV2DraftIssue.projectItem;
  return { ok: true, itemId: pi.id, contentId: pi.content?.id ?? null };
}

/** Reopen a closed issue or PR (drafts have no open/closed state). */
export async function reopenItem(args: {
  token: string;
  contentId: string;
  itemType: "issue" | "pr" | "draft";
}): Promise<MutationResult> {
  if (args.itemType === "draft") return { ok: false, error: "Drafts não têm estado aberto/fechado." };
  const query =
    args.itemType === "pr"
      ? `mutation($id: ID!) { reopenPullRequest(input: { pullRequestId: $id }) { pullRequest { id } } }`
      : `mutation($id: ID!) { reopenIssue(input: { issueId: $id }) { issue { id } } }`;
  return githubGraphQL(args.token, query, { id: args.contentId });
}

/** Archive a card (removes it from the active board, recoverable in GitHub). */
export async function archiveItem(args: {
  token: string;
  projectId: string;
  itemId: string;
}): Promise<MutationResult> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!) {
      archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        item { id }
      }
    }`;
  return githubGraphQL(args.token, query, args);
}

/** Permanently delete a card from the project. */
export async function deleteItem(args: {
  token: string;
  projectId: string;
  itemId: string;
}): Promise<MutationResult> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        deletedItemId
      }
    }`;
  return githubGraphQL(args.token, query, args);
}

// ---------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------

/**
 * Everyone GitHub allows assigning in the given repos (collaborators with
 * access) — the same list github.com offers in its own assignee picker.
 */
export async function fetchAssignableUsers(
  token: string,
  repos: { owner: string; name: string }[],
): Promise<{ login: string; avatarUrl: string }[]> {
  if (repos.length === 0) return [];
  const fields = repos
    .slice(0, 10)
    .map(
      (r, i) =>
        `r${i}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) {
          assignableUsers(first: 100) { nodes { login avatarUrl } }
        }`,
    )
    .join("\n");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query { ${fields} }` }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    data?: Record<string, { assignableUsers?: { nodes?: { login: string; avatarUrl: string }[] } } | null>;
  };
  const seen = new Map<string, { login: string; avatarUrl: string }>();
  for (const repo of Object.values(json.data ?? {})) {
    for (const u of repo?.assignableUsers?.nodes ?? []) {
      if (!seen.has(u.login.toLowerCase())) seen.set(u.login.toLowerCase(), u);
    }
  }
  return [...seen.values()];
}

/** Resolve GitHub logins → user node ids. Unknown logins are omitted. */
export async function resolveUserIds(
  token: string,
  logins: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(logins.map((l) => l.trim()).filter(Boolean))];
  if (unique.length === 0) return {};
  const fields = unique
    .map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { id login }`)
    .join("\n");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query { ${fields} }` }),
  });
  const json = (await res.json()) as { data?: Record<string, { id: string; login: string } | null> };
  const out: Record<string, string> = {};
  for (const v of Object.values(json.data ?? {})) {
    if (v?.id) out[v.login.toLowerCase()] = v.id;
  }
  return out;
}

/** Add/remove assignees on an Issue or PullRequest (content node id, not item id). */
export async function setIssueAssignees(args: {
  token: string;
  contentId: string;
  addIds: string[];
  removeIds: string[];
}): Promise<MutationResult> {
  // Declare ONLY the variables actually used — GitHub rejects a mutation that
  // declares $addIds/$removeIds without referencing them (e.g. add-only assigns).
  const parts: string[] = [];
  const decls: string[] = ["$contentId: ID!"];
  const vars: Record<string, unknown> = { contentId: args.contentId };
  if (args.addIds.length > 0) {
    decls.push("$addIds: [ID!]!");
    vars.addIds = args.addIds;
    parts.push(`add: addAssigneesToAssignable(input: { assignableId: $contentId, assigneeIds: $addIds }) { clientMutationId }`);
  }
  if (args.removeIds.length > 0) {
    decls.push("$removeIds: [ID!]!");
    vars.removeIds = args.removeIds;
    parts.push(`remove: removeAssigneesFromAssignable(input: { assignableId: $contentId, assigneeIds: $removeIds }) { clientMutationId }`);
  }
  if (parts.length === 0) return { ok: true };
  const query = `
    mutation(${decls.join(", ")}) {
      ${parts.join("\n")}
    }`;
  return githubGraphQL(args.token, query, vars);
}

/** Replace the assignee set on a draft-issue card. */
export async function setDraftAssignees(args: {
  token: string;
  draftId: string;
  assigneeIds: string[];
}): Promise<MutationResult> {
  const query = `
    mutation($draftId: ID!, $assigneeIds: [ID!]) {
      updateProjectV2DraftIssue(input: { draftIssueId: $draftId, assigneeIds: $assigneeIds }) {
        draftIssue { id }
      }
    }`;
  return githubGraphQL(args.token, query, { draftId: args.draftId, assigneeIds: args.assigneeIds });
}

// ---------------------------------------------------------------------------
// Content editing — title/body for issues, PRs, and draft cards
// ---------------------------------------------------------------------------

export async function updateItemContent(args: {
  token: string;
  type: "issue" | "pr" | "draft";
  contentId: string;
  title: string;
  body: string;
}): Promise<MutationResult> {
  const { token, type, contentId, title, body } = args;
  if (type === "draft") {
    const query = `
      mutation($id: ID!, $title: String!, $body: String) {
        updateProjectV2DraftIssue(input: { draftIssueId: $id, title: $title, body: $body }) {
          draftIssue { id }
        }
      }`;
    return githubGraphQL(token, query, { id: contentId, title, body });
  }
  if (type === "pr") {
    const query = `
      mutation($id: ID!, $title: String!, $body: String) {
        updatePullRequest(input: { pullRequestId: $id, title: $title, body: $body }) {
          pullRequest { id }
        }
      }`;
    return githubGraphQL(token, query, { id: contentId, title, body });
  }
  const query = `
    mutation($id: ID!, $title: String!, $body: String) {
      updateIssue(input: { id: $id, title: $title, body: $body }) {
        issue { id }
      }
    }`;
  return githubGraphQL(token, query, { id: contentId, title, body });
}

// ---------------------------------------------------------------------------
// Comments — read the thread and reply (issues + PRs)
// ---------------------------------------------------------------------------

export type ItemComment = {
  id: string;
  author: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
};

export async function fetchItemComments(
  token: string,
  contentId: string,
): Promise<MutationResult<{ comments: ItemComment[] }>> {
  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue { comments(last: 30) { nodes { id body createdAt author { login avatarUrl } } } }
        ... on PullRequest { comments(last: 30) { nodes { id body createdAt author { login avatarUrl } } } }
      }
    }`;
  const r = await githubGraphQL<{
    node?: { comments?: { nodes?: Array<{ id: string; body: string; createdAt: string; author?: { login: string; avatarUrl: string } }> } };
  }>(token, query, { id: contentId });
  if (!r.ok) return r;
  const comments: ItemComment[] = (r.data?.node?.comments?.nodes ?? []).map((c) => ({
    id: c.id,
    author: c.author?.login ?? "ghost",
    avatarUrl: c.author?.avatarUrl ?? "",
    body: c.body,
    createdAt: c.createdAt,
  }));
  return { ok: true, comments } as MutationResult<{ comments: ItemComment[] }> & { comments: ItemComment[] };
}

export async function addItemComment(args: {
  token: string;
  contentId: string;
  body: string;
}): Promise<MutationResult> {
  const query = `
    mutation($id: ID!, $body: String!) {
      addComment(input: { subjectId: $id, body: $body }) { clientMutationId }
    }`;
  return githubGraphQL(args.token, query, { id: args.contentId, body: args.body });
}

// ---------------------------------------------------------------------------
// Labels — repo label list + toggle on a labelable
// ---------------------------------------------------------------------------

export type RepoLabel = { id: string; name: string; color: string };

export async function fetchRepoMeta(
  token: string,
  owner: string,
  name: string,
): Promise<MutationResult<{ repoId: string; labels: RepoLabel[] }>> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        labels(first: 100) { nodes { id name color } }
      }
    }`;
  const r = await githubGraphQL<{ repository?: { id: string; labels?: { nodes?: RepoLabel[] } } }>(
    token,
    query,
    { owner, name },
  );
  if (!r.ok) return r;
  if (!r.data?.repository) return { ok: false, error: `Repository ${owner}/${name} not found` };
  return {
    ok: true,
    repoId: r.data.repository.id,
    labels: r.data.repository.labels?.nodes ?? [],
  } as MutationResult<{ repoId: string; labels: RepoLabel[] }> & { repoId: string; labels: RepoLabel[] };
}

/**
 * Make sure a set of labels exists on a repo, creating any that are missing
 * (via the REST labels API — its `node_id` is the GraphQL global id we need for
 * setItemLabels). Returns the repo id + the FULL current label list so callers
 * can resolve names → ids. Idempotent: a 422 (already exists) is treated as OK.
 */
export async function ensureRepoLabels(args: {
  token: string;
  owner: string;
  name: string;
  wanted: { name: string; color: string; description?: string }[];
}): Promise<MutationResult<{ repoId: string; labels: RepoLabel[] }>> {
  const meta = await fetchRepoMeta(args.token, args.owner, args.name);
  if (!meta.ok) return meta;
  const have = new Set(meta.labels.map((l) => l.name.toLowerCase()));
  const missing = args.wanted.filter((w) => !have.has(w.name.toLowerCase()));
  const created: RepoLabel[] = [];
  for (const w of missing) {
    const res = await fetch(`https://api.github.com/repos/${args.owner}/${args.name}/labels`, {
      method: "POST",
      headers: {
        Authorization: `bearer ${args.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: w.name, color: w.color, description: w.description ?? "" }),
    });
    if (res.ok) {
      const j = (await res.json()) as { node_id: string; name: string; color: string };
      created.push({ id: j.node_id, name: j.name, color: j.color });
    } else if (res.status === 422) {
      // Raced / already exists — re-read below to pick up its id.
    } else {
      return { ok: false, error: `Failed to create label "${w.name}" (${res.status})` };
    }
  }
  // If anything 422'd, re-fetch so we return its real id; otherwise merge.
  let labels = [...meta.labels, ...created];
  if (missing.length > created.length) {
    const fresh = await fetchRepoMeta(args.token, args.owner, args.name);
    if (fresh.ok) labels = fresh.labels;
  }
  return { ok: true, repoId: meta.repoId, labels } as MutationResult<{
    repoId: string;
    labels: RepoLabel[];
  }> & { repoId: string; labels: RepoLabel[] };
}

export async function setItemLabels(args: {
  token: string;
  contentId: string;
  addIds: string[];
  removeIds: string[];
}): Promise<MutationResult> {
  // Declare ONLY the variables we actually use — GitHub rejects a mutation that
  // declares an unused variable ("$removeIds is declared ... but not used"),
  // which broke every add-only / remove-only label toggle.
  const parts: string[] = [];
  const decls: string[] = ["$contentId: ID!"];
  const vars: Record<string, unknown> = { contentId: args.contentId };
  if (args.addIds.length > 0) {
    parts.push(`add: addLabelsToLabelable(input: { labelableId: $contentId, labelIds: $addIds }) { clientMutationId }`);
    decls.push("$addIds: [ID!]!");
    vars.addIds = args.addIds;
  }
  if (args.removeIds.length > 0) {
    parts.push(`remove: removeLabelsFromLabelable(input: { labelableId: $contentId, labelIds: $removeIds }) { clientMutationId }`);
    decls.push("$removeIds: [ID!]!");
    vars.removeIds = args.removeIds;
  }
  if (parts.length === 0) return { ok: true };
  const query = `mutation(${decls.join(", ")}) {\n${parts.join("\n")}\n}`;
  return githubGraphQL(args.token, query, vars);
}

// ---------------------------------------------------------------------------
// Real issues — create in a repo and drop onto the board
// ---------------------------------------------------------------------------

/** Convert a Project draft-issue item into a real repo issue (keeps the same
 *  board item). Returns the new issue's content id + url + number. */
export async function convertDraftToIssue(args: {
  token: string;
  itemId: string;
  repoId: string;
}): Promise<MutationResult<{ contentId: string; url: string; number: number }>> {
  const r = await githubGraphQL<{
    convertProjectV2DraftIssueItemToIssue: { item: { content: { id: string; url: string; number: number } | null } };
  }>(
    args.token,
    `mutation($itemId: ID!, $repoId: ID!) {
      convertProjectV2DraftIssueItemToIssue(input: { itemId: $itemId, repositoryId: $repoId }) {
        item { content { ... on Issue { id url number } } }
      }
    }`,
    { itemId: args.itemId, repoId: args.repoId },
  );
  if (!r.ok) return r;
  const c = r.data.convertProjectV2DraftIssueItemToIssue.item.content;
  if (!c) return { ok: false, error: "Convert returned no issue content." };
  return { ok: true, contentId: c.id, url: c.url, number: c.number } as MutationResult<{ contentId: string; url: string; number: number }> & { contentId: string; url: string; number: number };
}

export async function createRepoIssue(args: {
  token: string;
  projectId: string;
  repoId: string;
  title: string;
  body?: string;
}): Promise<MutationResult<{ itemId: string; url: string; contentId: string; number?: number }>> {
  const create = await githubGraphQL<{ createIssue: { issue: { id: string; url: string; number: number } } }>(
    args.token,
    `mutation($repoId: ID!, $title: String!, $body: String) {
      createIssue(input: { repositoryId: $repoId, title: $title, body: $body }) {
        issue { id url number }
      }
    }`,
    { repoId: args.repoId, title: args.title, body: args.body ?? "" },
  );
  if (!create.ok) return create;
  const issue = create.data.createIssue.issue;
  const add = await githubGraphQL<{ addProjectV2ItemById: { item: { id: string } } }>(
    args.token,
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId: args.projectId, contentId: issue.id },
  );
  if (!add.ok) return add;
  return {
    ok: true,
    itemId: add.data.addProjectV2ItemById.item.id,
    url: issue.url,
    contentId: issue.id,
    number: issue.number,
  } as MutationResult<{ itemId: string; url: string; contentId: string; number?: number }> & {
    itemId: string;
    url: string;
    contentId: string;
    number?: number;
  };
}

// ---------------------------------------------------------------------------
// Aggregated board (the SOPA hub) — union of every portal's Kanban by status.
// ---------------------------------------------------------------------------

export type AggregatedItem = KanbanItem & {
  board: string;
  projectSlug: string;
  /** The card's own GitHub Project board node id (for cross-project mutations). */
  projectId: string;
  /** Status single-select field id on that board (null if none). */
  statusFieldId: string | null;
  /** That board's status columns (name → optionId) — to map a drop target to an optionId. */
  statusOptions: { name: string; optionId: string }[];
};
export type AggregatedColumn = { name: string; items: AggregatedItem[] };

/** Fetch + merge ALL portals' GitHub Project boards into one (read-only). */
export async function fetchAggregatedBoards(): Promise<{ columns: AggregatedColumn[]; errors: string[] }> {
  const { getAllProjects } = await import("@/projects/index");
  const seen = new Set<string>();
  const colItems = new Map<string, AggregatedItem[]>();
  const order: string[] = [];
  const errors: string[] = [];
  for (const p of getAllProjects()) {
    if (!p.githubProject) continue;
    const key = `${p.githubProject.org}#${p.githubProject.number}`;
    if (seen.has(key)) continue; // shared boards counted once
    seen.add(key);
    const r = await fetchGitHubProject(p).catch(() => null);
    if (!r || !r.ok) {
      errors.push(`${p.name}: ${r && !r.ok ? r.error : "falhou"}`);
      continue;
    }
    const board = r.title || p.name;
    const statusOptions = r.columns.filter((c) => c.optionId).map((c) => ({ name: c.name, optionId: c.optionId! }));
    for (const col of r.columns) {
      if (!colItems.has(col.name)) {
        colItems.set(col.name, []);
        order.push(col.name);
      }
      for (const it of col.items) colItems.get(col.name)!.push({ ...it, board, projectSlug: p.slug, projectId: r.projectId, statusFieldId: r.statusFieldId, statusOptions });
    }
  }

  // Merge portal-owned fire priority + deadline, then sort each column
  // priority-first (the aggregated board has no within-column manual order).
  const { loadCardMeta } = await import("@/lib/card-meta");
  const { compareByPriority } = await import("@/lib/kanban-priority");
  const allItems = [...colItems.values()].flat();
  const meta = await loadCardMeta(allItems.map((i) => i.id));
  for (const it of allItems) {
    const m = meta.get(it.id);
    if (m) {
      it.firePriority = m.firePriority;
      it.deadline = m.deadline;
    }
  }
  for (const items of colItems.values()) items.sort(compareByPriority);

  return { columns: order.map((name) => ({ name, items: colItems.get(name)! })), errors };
}

// ---------------------------------------------------------------------------
// Recent commits — portal-side code delta for the morning briefing, so the dev
// agent never needs a local clone or `git pull`. Uses the same token as the
// board; cached briefly so multiple agents in one tick share the fetch.
// ---------------------------------------------------------------------------

export type RepoCommit = { repo: string; sha: string; message: string; author: string; date: string };

const commitsCache = new Map<string, { data: RepoCommit[]; expires: number }>();

export async function fetchRecentCommits(
  project: ProjectConfig,
  sinceIso: string | null,
): Promise<RepoCommit[]> {
  const token = resolveGitHubToken(project);
  if (!token || !project.repos?.length) return [];
  const since = sinceIso ?? new Date(Date.now() - 7 * 864e5).toISOString(); // fallback: last 7 days
  const key = `${project.slug}:${since}`;
  const hit = commitsCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.data;

  const out: RepoCommit[] = [];
  await Promise.all(
    project.repos.slice(0, 6).map(async (full) => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${full}/commits?since=${encodeURIComponent(since)}&per_page=30`,
          {
            headers: {
              Authorization: `bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            next: { revalidate: 300 },
          },
        );
        if (!res.ok) return;
        const arr = (await res.json()) as Array<{
          sha: string;
          commit: { message: string; author?: { name?: string; date?: string } };
          author?: { login?: string } | null;
        }>;
        for (const c of arr) {
          const msg = (c.commit?.message ?? "").split("\n")[0].trim();
          if (/^merge (branch|pull request|remote)/i.test(msg)) continue; // skip noise
          out.push({
            repo: full,
            sha: c.sha.slice(0, 7),
            message: msg.slice(0, 100),
            author: c.author?.login ?? c.commit?.author?.name ?? "?",
            date: c.commit?.author?.date ?? "",
          });
        }
      } catch {
        // best-effort per repo
      }
    }),
  );
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  commitsCache.set(key, { data: out, expires: Date.now() + 300_000 });
  return out;
}
