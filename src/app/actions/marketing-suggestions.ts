"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  publishCastToFarcaster,
  publishSnapToHive,
  publishToBinanceSquare,
  uploadImageToPinata,
  type Platform,
  type SchedulablePlatform,
} from "@/lib/social-publish";
import type { TopCreator } from "@/lib/skatehive-creators";
import type { SkatehivePost } from "@/lib/skatehive-content";
import { getActiveProject, getProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";

function defaultPrompt(project: ProjectConfig): string {
  return `You are the social media manager for ${project.name}.
Write short, punchy posts that celebrate the ${project.name} community: top creators, best recent posts, community news, and what's happening on the platform.

Guidelines:
- Casual, friendly tone (no corporate speak)
- Each post under 280 characters, including any URL
- When you reference a creator, use @handle and link their top post URL
- When you reference a post, include the post URL so Farcaster/Hive can render the embed
- If a "Posts we have ALREADY shared" block is provided, treat those as fully covered — do not paraphrase or repeat them
- Vary the angles: spotlight a creator, hype a specific post, recap the week, invite outsiders in
- Never use hashtags
- Return ONLY a JSON array of post strings, nothing else

Example output:
["Post 1 text here.", "Post 2 text here.", "Post 3 text here."]`;
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type TweetStatus = "drafted" | "approved" | "skipped" | "published";

export type PublishedRecord = {
  at: string;
  url?: string;
  ref?: string;
};

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

export type MarketingRunInputs = {
  topPosts?: SkatehivePost[];
  topCreators?: TopCreator[];
  briefingPreamble?: string;
  freePrompt?: string;
};

export type MarketingSuggestionRunRow = {
  id: string;
  status: string;
  jobStatus: string | null;
  editorialStatus: string;
  inputSummary: string | null;
  statusMessage: string | null;
  freePrompt: string | null;
  inputs: MarketingRunInputs;
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

export type MarketingSuggestionConfig = {
  prompt: string;
  useTopPosts: boolean;
  useBriefing: boolean;
  useTopCreators: boolean;
  freePromptHint: string;
};

export type MarketingSuggestionWorkerHealth = {
  status: "ok" | "degraded";
  db: "connected" | "unreachable";
  worker: "active" | "idle" | "stale" | "offline" | "unknown";
  pendingJobs: number;
  lastHeartbeat: string | null;
  checkedAt: string;
  reason?: string;
};

// ----------------------------------------------------------------------------
// Health + config
// ----------------------------------------------------------------------------

function classifyWorker(
  lastHeartbeat: Date | null,
  processing: boolean,
): MarketingSuggestionWorkerHealth["worker"] {
  if (!lastHeartbeat) return "offline";
  const ageMs = Date.now() - lastHeartbeat.getTime();
  if (ageMs < 30_000) return processing ? "active" : "idle";
  if (ageMs < 5 * 60_000) return "stale";
  return "offline";
}

export async function getMarketingSuggestionWorkerHealth(): Promise<MarketingSuggestionWorkerHealth> {
  let db: MarketingSuggestionWorkerHealth["db"] = "connected";
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

  const pendingJobs = await prisma.marketingSuggestionRun
    .count({ where: { jobStatus: { in: ["pending", "running"] } } })
    .catch(() => 0);

  const processing = await prisma.marketingSuggestionRun
    .count({ where: { jobStatus: "running" } })
    .then((n) => n > 0)
    .catch(() => false);

  const cfg = await prisma.marketingSuggestionConfig
    .findUnique({ where: { id: project.slug } })
    .catch(() => null);

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
        ? "Worker not running. Start it with `npm run worker:marketing-suggestions`."
        : undefined,
  };
}

export async function getMarketingSuggestionConfig(): Promise<MarketingSuggestionConfig> {
  const project = await getActiveProject();
  const row = await prisma.marketingSuggestionConfig.upsert({
    where: { id: project.slug },
    create: {
      id: project.slug,
      prompt: defaultPrompt(project),
      agentId: project.agent.id,
      hiveCommunity: project.hive.community,
      hiveFrontend: project.hive.frontend ?? null,
    },
    update: {
      agentId: project.agent.id,
      hiveCommunity: project.hive.community,
      hiveFrontend: project.hive.frontend ?? null,
    },
  });
  return {
    prompt: row.prompt,
    useTopPosts: row.useTopPosts,
    useBriefing: row.useBriefing,
    useTopCreators: row.useTopCreators,
    freePromptHint: row.freePromptHint,
  };
}

export async function saveMarketingSuggestionConfig(
  data: MarketingSuggestionConfig,
): Promise<void> {
  const project = await getActiveProject();
  await prisma.marketingSuggestionConfig.upsert({
    where: { id: project.slug },
    create: {
      id: project.slug,
      agentId: project.agent.id,
      hiveCommunity: project.hive.community,
      hiveFrontend: project.hive.frontend ?? null,
      ...data,
    },
    update: {
      ...data,
      agentId: project.agent.id,
      hiveCommunity: project.hive.community,
      hiveFrontend: project.hive.frontend ?? null,
    },
  });
  revalidatePath("/marketing-suggestions");
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function getRecentMarketingSuggestionRuns(
  limit = 20,
): Promise<MarketingSuggestionRunRow[]> {
  const project = await getActiveProject();
  const rows = await prisma.marketingSuggestionRun.findMany({
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
    freePrompt: r.freePrompt ?? null,
    inputs:
      r.inputs && typeof r.inputs === "object" && !Array.isArray(r.inputs)
        ? (r.inputs as unknown as MarketingRunInputs)
        : {},
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

// ----------------------------------------------------------------------------
// Enqueue
// ----------------------------------------------------------------------------

export async function enqueueMarketingSuggestionRun(
  freePrompt?: string,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  try {
    const config = await getMarketingSuggestionConfig();
    void config; // ensure config row exists for the active project

    const project = await getActiveProject();
    const trimmedPrompt = freePrompt?.trim() || null;
    const inputSummary = trimmedPrompt
      ? `Theme: ${trimmedPrompt.slice(0, 80)}${trimmedPrompt.length > 80 ? "…" : ""}`
      : "Community signals (top posts + creators + briefing)";

    const run = await prisma.marketingSuggestionRun.create({
      data: {
        configId: project.slug,
        status: "queued",
        jobStatus: "pending",
        editorialStatus: "drafted",
        inputSummary,
        freePrompt: trimmedPrompt,
      },
    });

    revalidatePath("/marketing-suggestions");
    return { ok: true, runId: run.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// Tweet mutations
// ----------------------------------------------------------------------------

export async function updateMarketingRunTweets(
  id: string,
  tweets: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.marketingSuggestionRun.update({ where: { id }, data: { tweets } });
    revalidatePath("/marketing-suggestions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setMarketingTweetState(
  runId: string,
  tweetIndex: number,
  status: TweetStatus,
  actor?: string,
): Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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
    await prisma.marketingSuggestionRun.update({
      where: { id: runId },
      data: { tweetStates: tweetStates as unknown as object },
    });

    revalidatePath("/marketing-suggestions");
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function scheduleMarketingTweetPublish(
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

    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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
    await prisma.marketingSuggestionRun.update({
      where: { id: runId },
      data: { tweetStates: tweetStates as unknown as object },
    });
    revalidatePath("/marketing-suggestions");
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelScheduledMarketingTweet(
  runId: string,
  tweetIndex: number,
  platform: SchedulablePlatform,
): Promise<{ ok: boolean; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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
    await prisma.marketingSuggestionRun.update({
      where: { id: runId },
      data: { tweetStates: tweetStates as unknown as object },
    });
    revalidatePath("/marketing-suggestions");
    return { ok: true, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteMarketingSuggestionRun(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.marketingSuggestionRun.delete({ where: { id } });
    revalidatePath("/marketing-suggestions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// Publish
// ----------------------------------------------------------------------------

async function recordPublish(
  runId: string,
  tweetIndex: number,
  platform: Platform,
  record: PublishedRecord,
): Promise<TweetStateMap> {
  const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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
  await prisma.marketingSuggestionRun.update({
    where: { id: runId },
    data: { tweetStates: next as unknown as object },
  });
  revalidatePath("/marketing-suggestions");
  return next;
}

async function getTweetText(runId: string, tweetIndex: number): Promise<string> {
  const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  const tweets = Array.isArray(run.tweets) ? (run.tweets as unknown as string[]) : [];
  if (tweetIndex < 0 || tweetIndex >= tweets.length) throw new Error("tweetIndex out of range");
  const text = tweets[tweetIndex];
  if (!text?.trim()) throw new Error("Tweet text is empty");
  return text;
}

export async function publishMarketingTweetToHive(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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

export async function publishMarketingTweetToFarcaster(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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

export async function publishMarketingTweetToBinance(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const run = await prisma.marketingSuggestionRun.findUnique({ where: { id: runId } });
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

export async function recordMarketingXPublish(
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

export async function uploadMarketingDraftImage(
  formData: FormData,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided" };
  return uploadImageToPinata(file);
}
