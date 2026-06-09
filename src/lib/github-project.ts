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
  assignees: { login: string; avatarUrl: string }[];
  labels: { name: string; color: string }[];
};

export type KanbanColumn = {
  name: string;
  items: KanbanItem[];
};

export type KanbanResult =
  | {
      ok: true;
      title: string;
      url: string;
      columns: KanbanColumn[];
      truncated: boolean;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

const QUERY = `
  query GetProject($login: String!, $number: Int!) {
    organization(login: $login) {
      projectV2(number: $number) {
        title
        url
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
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
                title
                number
                url
                state
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
                title
                number
                url
                state
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
                title
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
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchGitHubProject(project: ProjectConfig): Promise<KanbanResult> {
  // Resolve token
  const token =
    process.env[`${project.agent.gatewayEnvPrefix}_GITHUB_TOKEN`] ??
    process.env.GITHUB_TOKEN;

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
            title: string;
            url: string;
            field?: {
              options?: { id: string; name: string }[];
            };
            items: {
              nodes: Array<{
                id: string;
                type: string;
                content?: {
                  title?: string;
                  number?: number;
                  url?: string;
                  state?: string;
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

    // Surface GraphQL errors
    if (json.errors && json.errors.length > 0) {
      return { ok: false, error: json.errors[0].message };
    }

    const projectV2 = json.data?.organization?.projectV2;
    if (!projectV2) {
      return {
        ok: false,
        error: `Project #${number} not found in org "${org}". Check that the token has project + read:org scopes.`,
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
      const assignees = (content?.assignees?.nodes ?? []).map((a) => ({
        login: a.login,
        avatarUrl: a.avatarUrl,
      }));
      const labels = (content?.labels?.nodes ?? []).map((l) => ({
        name: l.name,
        color: l.color, // GitHub returns hex WITHOUT the #
      }));

      const item: KanbanItem = { id: node.id, type, title, number, url, state, merged, assignees, labels };

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
      items: columnMap.get(opt.name) ?? [],
    }));

    // Append "No Status" column only if there are items without a status
    if (noStatusItems.length > 0) {
      columns.push({ name: "No Status", items: noStatusItems });
    }

    return {
      ok: true,
      title: projectV2.title,
      url: projectV2.url,
      columns,
      truncated: rawItems.length === 100,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Unexpected error: ${message}` };
  }
}
