"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseGithubRepo, parseRepoUrls } from "@/lib/repo-to-social-utils";
import {
  publishCastToFarcaster,
  publishSnapToHive,
  publishToBinanceSquare,
  uploadImageToPinata,
  type PublishedRecord,
  type Platform,
  type SchedulablePlatform,
} from "@/lib/social-publish";
import { getActiveProject, getProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";

function defaultPrompt(project: ProjectConfig): string {
  const repoList = project.repos.map((r) => `- \`${r.split("/")[1]}\``).join("\n");
  return `You are the social media manager for ${project.name}.
Write short, punchy tweets about recent product updates landing in ${project.name}.

Repos:
${repoList}

Each commit includes a \`repo\` field that tells you which app the change ships to.

Guidelines:
- Casual, friendly tone (no corporate speak)
- Each tweet under 280 characters, including any URL
- Focus on user-visible changes — skip refactors, build/CI work, and other infra
- If a "Tweets we have ALREADY posted" block is provided, treat those features as fully covered: do NOT tweet about them again, do NOT paraphrase them, and skip the commit entirely unless it brings a genuinely new angle. When in doubt, skip rather than repeat
- Never use hashtags
- Return ONLY a JSON array of tweet strings, nothing else

Example output:
["Tweet 1 text here.", "Tweet 2 text here.", "Tweet 3 text here."]`;
}

export type CommitData = {
  sha: string;
  message: string;
  date: string;
  author: string;
  url: string;
  repo?: string;
};

export type TweetStatus = "drafted" | "approved" | "skipped" | "published";

export type TweetState = {
  status: TweetStatus;
  approvedBy?: string;
  approvedAt?: string;
  publishedAt?: string;
  publishedTo?: Partial<Record<Platform, PublishedRecord>>;
  scheduledFor?: Partial<Record<SchedulablePlatform, string>>;
};

export type TweetStateMap = Record<string, TweetState>;

export type TweetComment = {
  id: string;
  tweetIndex: number;
  author: string;
  body: string;
  createdAt: Date;
};

export type VoteValue = 1 | -1;

export type TweetVote = {
  id: string;
  tweetIndex: number;
  voter: string;
  value: VoteValue;
  createdAt: Date;
};

export type RepoToSocialRunRow = {
  id: string;
  status: string;
  jobStatus: string | null;
  editorialStatus: string;
  inputSummary: string | null;
  statusMessage: string | null;
  commits: CommitData[];
  tweets: string[];
  tweetStates: TweetStateMap;
  comments: TweetComment[];
  votes: TweetVote[];
  error: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  claimedAt: Date | null;
  startedAt: Date;
  durationMs: number | null;
};

export type RepoToSocialWorkerHealth = {
  status: "ok" | "degraded";
  db: "connected" | "unreachable";
  worker: "active" | "idle" | "stale" | "offline" | "unknown";
  pendingJobs: number;
  lastHeartbeat: string | null;
  checkedAt: string;
  reason?: string;
};

function classifyWorker(
  lastHeartbeat: Date | null,
  processing: boolean,
): RepoToSocialWorkerHealth["worker"] {
  if (!lastHeartbeat) return "offline";
  const ageMs = Date.now() - lastHeartbeat.getTime();
  if (ageMs < 30_000) return processing ? "active" : "idle";
  if (ageMs < 5 * 60_000) return "stale";
  return "offline";
}

export async function getRepoToSocialWorkerHealth(): Promise<RepoToSocialWorkerHealth> {
  let db: RepoToSocialWorkerHealth["db"] = "connected";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "unreachable";
  }

  if (db === "unreachable") {
    return {
      status: "degraded",
      db,
      worker: "unknown",
      pendingJobs: 0,
      lastHeartbeat: null,
      checkedAt: new Date().toISOString(),
      reason: "Database unreachable. Set DATABASE_URL in .env.local and run `npx prisma db push`.",
    };
  }

  const project = await getActiveProject();

  const pendingJobs = await prisma.repoToSocialRun.count({
    where: { jobStatus: { in: ["pending", "running"] } },
  }).catch(() => 0);

  const processing = await prisma.repoToSocialRun.count({
    where: { jobStatus: "running" },
  }).then((n) => n > 0).catch(() => false);

  const cfg = await prisma.repoToSocialConfig.findUnique({
    where: { id: project.slug },
  }).catch(() => null);

  const lastHeartbeat = cfg?.lastWorkerHeartbeat ?? null;
  const worker = classifyWorker(lastHeartbeat, processing);

  return {
    status: db === "connected" && worker !== "offline" ? "ok" : "degraded",
    db,
    worker,
    pendingJobs,
    lastHeartbeat: lastHeartbeat ? lastHeartbeat.toISOString() : null,
    checkedAt: new Date().toISOString(),
    reason:
      worker === "offline"
        ? "Worker not running. Start it with `npm run worker:repo-to-social`."
        : undefined,
  };
}

export async function getRepoToSocialConfig() {
  const project = await getActiveProject();
  const defaultRepoUrls = project.repos.map((r) => `https://github.com/${r}`);
  const row = await prisma.repoToSocialConfig.upsert({
    where: { id: project.slug },
    create: {
      id: project.slug,
      repoUrl: defaultRepoUrls.join("\n"),
      prompt: defaultPrompt(project),
      agentId: project.agent.id,
    },
    update: { agentId: project.agent.id },
  });
  // Same healing as the suggestions config: an empty prompt would otherwise
  // show an empty editor AND make the worker generate without guidelines.
  //
  // A MESMA cura vale para a lista de repos, e a falta dela era um bug: o
  // `create` acima preenche `repoUrl` a partir de `project.repos`, mas o
  // `update` só toca o `agentId`. Um projeto cuja linha nasceu ANTES de ele
  // declarar repos ficava com a lista vazia para sempre — a config existe, o
  // upsert não recria, e o default nunca mais é aplicado. Foi exatamente o que
  // aconteceu com o swaps: a linha nasceu quando `repos` era `[]`, e continuou
  // vazia depois que o repo foi declarado.
  //
  // Só cura o VAZIO. Lista que alguém editou — inclusive para remover um repo —
  // é escolha e não se mexe.
  const patch: { prompt?: string; repoUrl?: string } = {};
  if (!row.prompt.trim()) patch.prompt = defaultPrompt(project);
  if (!row.repoUrl.trim() && defaultRepoUrls.length > 0) patch.repoUrl = defaultRepoUrls.join("\n");
  if (Object.keys(patch).length > 0) {
    return prisma.repoToSocialConfig.update({ where: { id: project.slug }, data: patch });
  }
  return row;
}

export async function saveRepoToSocialConfig(data: {
  repoUrl: string;
  prompt: string;
}) {
  const project = await getActiveProject();
  await prisma.repoToSocialConfig.upsert({
    where: { id: project.slug },
    create: { id: project.slug, agentId: project.agent.id, ...data },
    update: { repoUrl: data.repoUrl, prompt: data.prompt, agentId: project.agent.id },
  });
  revalidatePath("/repo-to-social");
}

export async function getRecentRepoToSocialRuns(limit = 20): Promise<RepoToSocialRunRow[]> {
  const project = await getActiveProject();
  const rows = await prisma.repoToSocialRun.findMany({
    where: { configId: project.slug },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      votes: { orderBy: { createdAt: "asc" } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    jobStatus: r.jobStatus ?? null,
    editorialStatus: r.editorialStatus ?? "drafted",
    inputSummary: r.inputSummary ?? null,
    statusMessage: r.statusMessage ?? null,
    commits: Array.isArray(r.commits) ? (r.commits as unknown as CommitData[]) : [],
    tweets: Array.isArray(r.tweets) ? (r.tweets as unknown as string[]) : [],
    tweetStates:
      r.tweetStates && typeof r.tweetStates === "object" && !Array.isArray(r.tweetStates)
        ? (r.tweetStates as unknown as TweetStateMap)
        : {},
    comments: r.comments.map((c) => ({
      id: c.id,
      tweetIndex: c.tweetIndex,
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
    })),
    votes: r.votes.map((v) => ({
      id: v.id,
      tweetIndex: v.tweetIndex,
      voter: v.voter,
      value: (v.value === -1 ? -1 : 1) as VoteValue,
      createdAt: v.createdAt,
    })),
    error: r.error ?? null,
    approvedBy: r.approvedBy ?? null,
    approvedAt: r.approvedAt ?? null,
    publishedAt: r.publishedAt ?? null,
    claimedAt: r.claimedAt ?? null,
    startedAt: r.startedAt,
    durationMs: r.durationMs ?? null,
  }));
}

async function fetchRecentCommits(owner: string, repo: string): Promise<CommitData[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=15`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub API error for ${owner}/${repo}: ${res.status}`);
  const data = (await res.json()) as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author: { name: string; date: string } };
    author?: { login: string };
  }>;
  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    date: c.commit.author.date,
    author: c.author?.login ?? c.commit.author.name,
    url: c.html_url,
    repo,
  }));
}

export async function enqueueRepoToSocialRun(): Promise<{
  ok: boolean;
  runId?: string;
  error?: string;
}> {
  try {
    const config = await getRepoToSocialConfig();
    const repoUrls = parseRepoUrls(config.repoUrl);
    if (repoUrls.length === 0) return { ok: false, error: "No repository URLs configured." };

    let commits: CommitData[];
    try {
      const perRepo = await Promise.all(
        repoUrls.map(async (url) => {
          const parsed = parseGithubRepo(url);
          if (!parsed) throw new Error(`Invalid repository URL: ${url}`);
          return fetchRecentCommits(parsed.owner, parsed.repo);
        }),
      );
      commits = perRepo
        .flat()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 30);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (commits.length === 0) return { ok: false, error: "No commits available to queue." };

    const repoLabel = repoUrls.length === 1 ? repoUrls[0] : `${repoUrls.length} repos`;
    const inputSummary = `${commits.length} commit${commits.length > 1 ? "s" : ""} from ${repoLabel} — latest: ${commits[0]?.message ?? "none"}`;

    const run = await prisma.repoToSocialRun.create({
      data: {
        configId: config.id,
        status: "queued",
        jobStatus: "pending",
        editorialStatus: "drafted",
        inputSummary,
        commits: commits as unknown as object,
      },
    });

    revalidatePath("/repo-to-social");
    return { ok: true, runId: run.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateRunTweets(
  id: string,
  tweets: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.repoToSocialRun.update({ where: { id }, data: { tweets } });
    revalidatePath("/repo-to-social");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setTweetState(
  runId: string,
  tweetIndex: number,
  status: TweetStatus,
  actor?: string,
): Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found" };

    const tweets = Array.isArray(run.tweets) ? (run.tweets as unknown as string[]) : [];
    if (tweetIndex < 0 || tweetIndex >= tweets.length) {
      return { ok: false, error: "tweetIndex out of range" };
    }

    const prev: TweetStateMap =
      run.tweetStates && typeof run.tweetStates === "object" && !Array.isArray(run.tweetStates)
        ? (run.tweetStates as unknown as TweetStateMap)
        : {};
    const prevEntry = prev[String(tweetIndex)] ?? { status: "drafted" as const };
    const nowIso = new Date().toISOString();

    const nextEntry: TweetState = { ...prevEntry, status };
    if (status === "approved") {
      nextEntry.approvedAt = nowIso;
      if (actor) nextEntry.approvedBy = actor;
    } else if (status === "published") {
      nextEntry.publishedAt = nowIso;
    } else if (status === "drafted") {
      delete nextEntry.approvedAt;
      delete nextEntry.approvedBy;
      delete nextEntry.publishedAt;
    }

    const tweetStates: TweetStateMap = { ...prev, [String(tweetIndex)]: nextEntry };
    await prisma.repoToSocialRun.update({
      where: { id: runId },
      data: { tweetStates: tweetStates as unknown as object },
    });

    revalidatePath("/repo-to-social");
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function scheduleTweetPublish(
  runId: string,
  tweetIndex: number,
  platform: SchedulablePlatform,
  whenISO: string,
): Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const when = new Date(whenISO);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date" };
    if (when.getTime() < Date.now() - 60_000) {
      return { ok: false, error: "Cannot schedule in the past" };
    }

    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found" };
    const tweets = Array.isArray(run.tweets) ? (run.tweets as unknown as string[]) : [];
    if (tweetIndex < 0 || tweetIndex >= tweets.length) {
      return { ok: false, error: "tweetIndex out of range" };
    }

    const prev: TweetStateMap =
      run.tweetStates && typeof run.tweetStates === "object" && !Array.isArray(run.tweetStates)
        ? (run.tweetStates as unknown as TweetStateMap)
        : {};
    const key = String(tweetIndex);
    const prevEntry = prev[key] ?? { status: "drafted" as const };
    if (prevEntry.publishedTo?.[platform]) {
      return { ok: false, error: `Already published to ${platform}` };
    }

    const nextEntry: TweetState = {
      ...prevEntry,
      scheduledFor: { ...(prevEntry.scheduledFor ?? {}), [platform]: when.toISOString() },
    };
    const tweetStates: TweetStateMap = { ...prev, [key]: nextEntry };
    await prisma.repoToSocialRun.update({
      where: { id: runId },
      data: { tweetStates: tweetStates as unknown as object },
    });
    revalidatePath("/repo-to-social");
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelScheduledTweet(
  runId: string,
  tweetIndex: number,
  platform: SchedulablePlatform,
): Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found" };
    const prev: TweetStateMap =
      run.tweetStates && typeof run.tweetStates === "object" && !Array.isArray(run.tweetStates)
        ? (run.tweetStates as unknown as TweetStateMap)
        : {};
    const key = String(tweetIndex);
    const prevEntry = prev[key];
    if (!prevEntry?.scheduledFor?.[platform]) {
      return { ok: true, tweetStates: prev };
    }
    const nextScheduled = { ...prevEntry.scheduledFor };
    delete nextScheduled[platform];
    const nextEntry: TweetState = { ...prevEntry };
    if (Object.keys(nextScheduled).length === 0) {
      delete nextEntry.scheduledFor;
    } else {
      nextEntry.scheduledFor = nextScheduled;
    }
    const tweetStates: TweetStateMap = { ...prev, [key]: nextEntry };
    await prisma.repoToSocialRun.update({
      where: { id: runId },
      data: { tweetStates: tweetStates as unknown as object },
    });
    revalidatePath("/repo-to-social");
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteRepoToSocialRun(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.repoToSocialRun.delete({ where: { id } });
    revalidatePath("/repo-to-social");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// Publishing — pushes a tweet to Hive (snap in hive-173115) and/or
// Farcaster (cast in /skateboard as @skatehive via Neynar managed signer).
// The protocol-level work lives in @/lib/social-publish; this layer just
// loads the tweet text and writes the result back to the run row.
// X publishing stays client-side via twitter.com/intent.
// ----------------------------------------------------------------------------

async function recordPublish(
  runId: string,
  tweetIndex: number,
  platform: Platform,
  record: PublishedRecord,
): Promise<TweetStateMap> {
  const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  const prev: TweetStateMap =
    run.tweetStates && typeof run.tweetStates === "object" && !Array.isArray(run.tweetStates)
      ? (run.tweetStates as unknown as TweetStateMap)
      : {};
  const key = String(tweetIndex);
  const prevEntry = prev[key] ?? { status: "drafted" as const };
  const nextEntry: TweetState = {
    ...prevEntry,
    status: "published",
    publishedAt: record.at,
    publishedTo: { ...(prevEntry.publishedTo ?? {}), [platform]: record },
  };
  const next: TweetStateMap = { ...prev, [key]: nextEntry };
  await prisma.repoToSocialRun.update({
    where: { id: runId },
    data: { tweetStates: next as unknown as object },
  });
  revalidatePath("/repo-to-social");
  return next;
}

async function getTweetText(runId: string, tweetIndex: number): Promise<string> {
  const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  const tweets = Array.isArray(run.tweets) ? (run.tweets as unknown as string[]) : [];
  if (tweetIndex < 0 || tweetIndex >= tweets.length) throw new Error("tweetIndex out of range");
  const text = tweets[tweetIndex];
  if (!text?.trim()) throw new Error("Tweet text is empty");
  return text;
}

export async function publishTweetToHive(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found" };
    const project = getProject(run.configId);
    const text = await getTweetText(runId, tweetIndex);
    const result = await publishSnapToHive(text, project);
    if (!result.ok) return { ok: false, error: result.error };

    const tweetStates = await recordPublish(runId, tweetIndex, "hive", {
      at: new Date().toISOString(),
      url: result.url,
      ref: result.ref,
    });
    return { ok: true, url: result.url, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishTweetToFarcaster(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found" };
    const project = getProject(run.configId);
    const text = await getTweetText(runId, tweetIndex);
    const result = await publishCastToFarcaster(text, project);
    if (!result.ok) return { ok: false, error: result.error };

    const tweetStates = await recordPublish(runId, tweetIndex, "farcaster", {
      at: new Date().toISOString(),
      url: result.url,
      ref: result.ref,
    });
    return { ok: true, url: result.url, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishTweetToBinance(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "Run not found" };
    const project = getProject(run.configId);
    const text = await getTweetText(runId, tweetIndex);
    const result = await publishToBinanceSquare(text, project);
    if (!result.ok) return { ok: false, error: result.error };

    const tweetStates = await recordPublish(runId, tweetIndex, "binance", {
      at: new Date().toISOString(),
      url: result.url,
      ref: result.ref,
    });
    return { ok: true, url: result.url, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function recordXPublish(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const tweetStates = await recordPublish(runId, tweetIndex, "x", {
      at: new Date().toISOString(),
    });
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// Image upload — Pinata IPFS. Used by the dialog's "Add image" button so
// drafts can include media before publishing.
// ----------------------------------------------------------------------------

export async function uploadDraftImage(
  formData: FormData,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided" };
  return uploadImageToPinata(file);
}
