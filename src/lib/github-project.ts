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
  labels: { name: string; color: string }[];
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
                  labels?: { nodes: { name: string; color: string }[] };
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
                  labels?: { nodes: { name: string; color: string }[] };
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
        name: l.name,
        color: l.color, // GitHub returns hex WITHOUT the #
      }));

      const contentId = content?.id ?? null;
      const item: KanbanItem = { id: node.id, type, title, number, url, state, merged, body, contentId, assignees, labels };

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
}): Promise<MutationResult<{ itemId: string }>> {
  const query = `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
        projectItem { id }
      }
    }`;
  const r = await githubGraphQL<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
    args.token,
    query,
    args,
  );
  if (!r.ok) return r;
  return { ok: true, itemId: r.data.addProjectV2DraftIssue.projectItem.id };
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
  const parts: string[] = [];
  if (args.addIds.length > 0) {
    parts.push(`add: addAssigneesToAssignable(input: { assignableId: $contentId, assigneeIds: $addIds }) { clientMutationId }`);
  }
  if (args.removeIds.length > 0) {
    parts.push(`remove: removeAssigneesFromAssignable(input: { assignableId: $contentId, assigneeIds: $removeIds }) { clientMutationId }`);
  }
  if (parts.length === 0) return { ok: true };
  const query = `
    mutation($contentId: ID!, $addIds: [ID!]!, $removeIds: [ID!]!) {
      ${parts.join("\n")}
    }`;
  return githubGraphQL(args.token, query, {
    contentId: args.contentId,
    addIds: args.addIds,
    removeIds: args.removeIds,
  });
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
