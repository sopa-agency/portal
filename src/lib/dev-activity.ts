import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { resolveGitHubToken } from "@/lib/github-project";

// O que mudou no código de um projeto: PRs mesclados (é deles que saem as
// features e as correções), commits que entraram sem PR, PRs abertos e releases,
// nos repositórios que o projeto declara em `repos`.
//
// Duas regras: (1) repositório que não deu para ler aparece em `unreadable` —
// lista vazia e "não li" são coisas diferentes; (2) cache de 5 min em memória,
// porque um agente pergunta a mesma coisa várias vezes seguidas e o consolidado
// da SOPA varre todos os repositórios de uma vez.

/** `branch` só vem quando a mudança ainda NÃO está no branch padrão do repositório. */
export type Change = { kind: "feature" | "fix" | "other"; title: string; repo: string; pr: number | null; by: string; at: string; url: string; summary?: string; branch?: string };
export type OpenPr = { title: string; repo: string; number: number; by: string; draft: boolean; updatedAt: string; url: string };
export type Release = { repo: string; tag: string; name: string; at: string; url: string };
/** Branch com commit dentro da janela que ainda não é o padrão: trabalho em andamento. */
export type ActiveBranch = { name: string; lastCommitAt: string; lastCommit: string; by: string; /** Commits na janela que o branch padrão ainda não tem. */ commits: number };
export type RepoPulse = {
  repo: string;
  defaultBranch: string | null;
  /** Commits no branch padrão dentro da janela. */
  commits: number;
  mergedPrs: number;
  openPrs: number;
  contributors: string[];
  /** Último commit no branch padrão, mesmo fora da janela: "parado desde quando". */
  lastCommitAt: string | null;
  /** Último push em QUALQUER branch. Mais novo que lastCommitAt = há trabalho fora do padrão. */
  lastPushAt: string | null;
  activeBranches: ActiveBranch[];
};
export type DevActivity = { since: string; days: number; repos: RepoPulse[]; features: Change[]; fixes: Change[]; other: Change[]; openPullRequests: OpenPr[]; releases: Release[]; unreadable: { repo: string; why: string }[] };

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: DevActivity }>();

/** feat(x): … → feature · fix(x): … → fix · o resto → other. Sem prefixo, o verbo decide. */
function kindOf(title: string): Change["kind"] {
  const t = title.trim().toLowerCase();
  if (/^feat(\(|:|!)/.test(t) || /^(add|adiciona|novo|nova|new)\b/.test(t)) return "feature";
  if (/^(fix|hotfix|bugfix)(\(|:|!)/.test(t) || /^(corrige|conserta|fix)\b/.test(t)) return "fix";
  return "other";
}

/** O primeiro parágrafo útil do corpo do PR, sem títulos nem listas de verificação. */
function excerpt(body: string | null | undefined): string | undefined {
  const text = (body ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim())
    .find((p) => p.length > 40 && !/^[-*|]/.test(p));
  return text ? (text.length > 320 ? `${text.slice(0, 320)}…` : text) : undefined;
}

export async function fetchDevActivity(project: ProjectConfig, days: number): Promise<DevActivity> {
  const key = `${project.slug}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const sinceDate = new Date(Date.now() - days * 86_400_000);
  const since = sinceDate.toISOString();
  const out: DevActivity = { since, days, repos: [], features: [], fixes: [], other: [], openPullRequests: [], releases: [], unreadable: [] };
  const token = resolveGitHubToken(project);
  const repos = (project.repos ?? []).slice(0, 8);
  if (!repos.length) return out;
  if (!token) {
    out.unreadable = repos.map((repo) => ({ repo, why: "no GitHub token configured for this project" }));
    return out;
  }

  const gh = async <T>(path: string): Promise<{ ok: true; data: T } | { ok: false; why: string }> => {
    try {
      const res = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, next: { revalidate: 300 } });
      if (!res.ok) return { ok: false, why: res.status === 404 ? "not found or no access with the portal's token" : `GitHub HTTP ${res.status}` };
      return { ok: true, data: (await res.json()) as T };
    } catch (err) {
      return { ok: false, why: err instanceof Error ? err.message.slice(0, 80) : "network error" };
    }
  };

  type GhCommit = { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null };
  type GhPull = { number: number; title: string; html_url: string; body: string | null; draft?: boolean; merged_at: string | null; updated_at: string; user?: { login?: string } | null };
  type GhRelease = { tag_name: string; name: string | null; html_url: string; published_at: string | null; draft: boolean };
  type GqlRepo = { repository: { pushedAt: string | null; defaultBranchRef: { name: string; target: { committedDate?: string } | null } | null; refs: { nodes: { name: string; target: { committedDate?: string; messageHeadline?: string; author?: { name?: string | null; user?: { login?: string } | null } | null } | null }[] } } | null };

  // Uma consulta GraphQL por repositório: branch padrão, último push e os branches mexidos por último.
  const branchesOf = async (repo: string): Promise<GqlRepo["repository"]> => {
    const [owner, name] = repo.split("/");
    try {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query: `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ pushedAt defaultBranchRef{ name target{ ... on Commit{ committedDate } } } refs(refPrefix:"refs/heads/", first:15, orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){ nodes{ name target{ ... on Commit{ committedDate messageHeadline author{ name user{ login } } } } } } } }`, variables: { owner, name } }),
        next: { revalidate: 300 },
      });
      if (!res.ok) return null;
      return ((await res.json()) as { data?: GqlRepo }).data?.repository ?? null;
    } catch {
      return null;
    }
  };

  await Promise.all(
    repos.map(async (repo) => {
      const [commits, closed, open, releases, meta] = await Promise.all([
        gh<GhCommit[]>(`/repos/${repo}/commits?since=${encodeURIComponent(since)}&per_page=60`),
        gh<GhPull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=40`),
        gh<GhPull[]>(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=20`),
        gh<GhRelease[]>(`/repos/${repo}/releases?per_page=5`),
        branchesOf(repo),
      ]);
      if (!commits.ok) {
        out.unreadable.push({ repo, why: commits.why });
        return;
      }
      const real = commits.data.filter((c) => !/^merge (branch|pull request|remote)/i.test(c.commit.message));
      const merged = closed.ok ? closed.data.filter((p) => p.merged_at && p.merged_at >= since) : [];
      const mergedNumbers = new Set(merged.map((p) => p.number));
      for (const p of merged) {
        const change: Change = { kind: kindOf(p.title), title: p.title.trim(), repo, pr: p.number, by: p.user?.login ?? "?", at: p.merged_at!, url: p.html_url, summary: excerpt(p.body) };
        (change.kind === "feature" ? out.features : change.kind === "fix" ? out.fixes : out.other).push(change);
      }
      // Commit que entrou sem PR (push direto). O squash de um PR termina em "(#123)" e já foi contado acima.
      for (const c of real) {
        const title = c.commit.message.split("\n")[0].trim();
        const ref = /\(#(\d+)\)\s*$/.exec(title);
        if (ref && mergedNumbers.has(Number(ref[1]))) continue;
        const change: Change = { kind: kindOf(title), title: title.slice(0, 140), repo, pr: ref ? Number(ref[1]) : null, by: c.author?.login ?? c.commit.author?.name ?? "?", at: c.commit.author?.date ?? "", url: c.html_url };
        (change.kind === "feature" ? out.features : change.kind === "fix" ? out.fixes : out.other).push(change);
      }
      if (open.ok) for (const p of open.data) out.openPullRequests.push({ title: p.title.trim(), repo, number: p.number, by: p.user?.login ?? "?", draft: !!p.draft, updatedAt: p.updated_at, url: p.html_url });
      if (releases.ok) for (const r of releases.data) if (!r.draft && r.published_at && r.published_at >= since) out.releases.push({ repo, tag: r.tag_name, name: r.name ?? r.tag_name, at: r.published_at, url: r.html_url });
      const defaultBranch = meta?.defaultBranchRef?.name ?? null;
      const activeBranches: ActiveBranch[] = (meta?.refs.nodes ?? [])
        .filter((b) => b.name !== defaultBranch && (b.target?.committedDate ?? "") >= since)
        .slice(0, 6)
        .map((b) => ({ name: b.name, lastCommitAt: b.target!.committedDate!, lastCommit: (b.target?.messageHeadline ?? "").slice(0, 120), by: b.target?.author?.user?.login ?? b.target?.author?.name ?? "?", commits: 0 }));
      // O que os dois branches mais mexidos têm e o padrão ainda não tem: é o trabalho
      // em andamento, e num repositório que desenvolve fora do padrão é TODO o trabalho.
      const onDefault = new Set(commits.data.map((c) => c.sha));
      const seenAhead = new Set<string>();
      await Promise.all(
        activeBranches.slice(0, 2).map(async (b) => {
          const ahead = await gh<GhCommit[]>(`/repos/${repo}/commits?sha=${encodeURIComponent(b.name)}&since=${encodeURIComponent(since)}&per_page=100`);
          if (!ahead.ok) return;
          for (const c of ahead.data) {
            if (onDefault.has(c.sha) || seenAhead.has(c.sha) || /^merge (branch|pull request|remote)/i.test(c.commit.message)) continue;
            seenAhead.add(c.sha);
            b.commits += 1;
            const title = c.commit.message.split("\n")[0].trim();
            const change: Change = { kind: kindOf(title), title: title.slice(0, 140), repo, pr: null, by: c.author?.login ?? c.commit.author?.name ?? "?", at: c.commit.author?.date ?? "", url: c.html_url, branch: b.name };
            (change.kind === "feature" ? out.features : change.kind === "fix" ? out.fixes : out.other).push(change);
          }
        }),
      );
      out.repos.push({
        repo,
        defaultBranch,
        commits: real.length,
        mergedPrs: merged.length,
        openPrs: open.ok ? open.data.length : 0,
        contributors: [...new Set(real.map((c) => c.author?.login ?? c.commit.author?.name ?? "?"))].slice(0, 8),
        lastCommitAt: real[0]?.commit.author?.date ?? meta?.defaultBranchRef?.target?.committedDate ?? null,
        lastPushAt: meta?.pushedAt ?? null,
        activeBranches,
      });
    }),
  );

  const newest = (a: { at: string }, b: { at: string }) => (a.at < b.at ? 1 : -1);
  out.features.sort(newest);
  out.fixes.sort(newest);
  out.other.sort(newest);
  out.releases.sort(newest);
  out.openPullRequests.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  out.repos.sort((a, b) => b.commits - a.commits);
  cache.set(key, { at: Date.now(), value: out });
  return out;
}
