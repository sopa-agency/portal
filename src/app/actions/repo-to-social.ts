"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseGithubRepo, parseRepoUrls } from "@/lib/repo-to-social-utils";

const DEFAULT_PROMPT = `You are the social media manager for SkateHive, a community-owned skateboarding platform built on Hive.
Write short, punchy tweets about recent product updates landing in SkateHive.

SkateHive ships two apps:
- Webapp (commits from repo \`skatehive3.0\`) — live at https://skatehive.app
- Mobile app (commits from repo \`mobileapp\`) — iOS: https://apps.apple.com/ca/app/skatehive/id6751173076

Each commit includes a \`repo\` field that tells you which app the change ships to.

Guidelines:
- Casual, skater-friendly tone (no corporate speak)
- Each tweet under 280 characters, including any URL
- Focus on user-visible changes — skip refactors, build/CI work, and other infra
- Name which app the tweet is about (e.g. "on the webapp", "in the SkateHive iOS app")
- For webapp tweets, link https://skatehive.app — use a specific sub-page (e.g. https://skatehive.app/feed) only if the commit clearly maps to one; never invent paths
- For mobile-app tweets, include the App Store link https://apps.apple.com/ca/app/skatehive/id6751173076 only sometimes — when the feature is worth downloading for, a fresh-install hook, or a big launch. Skip the link for small fixes or repeat-flavor updates
- Never use hashtags
- Return ONLY a JSON array of tweet strings, nothing else

Example output:
["Tweet 1 text here.", "Tweet 2 text here.", "Tweet 3 text here."]`;

const DEFAULT_REPO_URLS = ["https://github.com/SkateHive/skatehive3.0"];

export type CommitData = {
  sha: string;
  message: string;
  date: string;
  author: string;
  url: string;
  repo?: string;
};

export type TweetStatus = "drafted" | "approved" | "skipped" | "published";

export type Platform = "x" | "hive" | "farcaster";

export type PublishedRecord = {
  at: string;
  url?: string;
  ref?: string; // Hive permlink or Farcaster cast hash
};

export type SchedulablePlatform = "hive" | "farcaster";

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

  const pendingJobs = await prisma.repoToSocialRun.count({
    where: { jobStatus: { in: ["pending", "running"] } },
  }).catch(() => 0);

  const processing = await prisma.repoToSocialRun.count({
    where: { jobStatus: "running" },
  }).then((n) => n > 0).catch(() => false);

  const cfg = await prisma.repoToSocialConfig.findUnique({
    where: { id: "singleton" },
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
  return prisma.repoToSocialConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      repoUrl: DEFAULT_REPO_URLS.join("\n"),
      prompt: DEFAULT_PROMPT,
    },
    update: {},
  });
}

export async function saveRepoToSocialConfig(data: {
  repoUrl: string;
  prompt: string;
}) {
  await prisma.repoToSocialConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: { repoUrl: data.repoUrl, prompt: data.prompt },
  });
  revalidatePath("/repo-to-social");
}

export async function getRecentRepoToSocialRuns(limit = 20): Promise<RepoToSocialRunRow[]> {
  const rows = await prisma.repoToSocialRun.findMany({
    where: { configId: "singleton" },
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
        configId: "singleton",
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
// Publishing — pushes a tweet to Hive (root post in hive-173115) and/or
// Farcaster (cast in /skateboard as @skatehive via Neynar managed signer).
// X publishing stays client-side via twitter.com/intent.
// ----------------------------------------------------------------------------

const HIVE_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu",
];
const HIVE_COMMUNITY_TAG = "hive-173115";
const SNAPS_CONTAINER_AUTHOR = "peak.snaps";
const FC_CHANNEL_ID = "skateboard";

function snapPermlink(): string {
  // Random UUID — matches skatehive3.0 web app's SnapComposer
  return `snap-${crypto.randomUUID()}`;
}

async function getLatestSnapsContainerPermlink(client: {
  database: { call: (m: string, p: unknown[]) => Promise<unknown> };
}): Promise<string> {
  const result = (await client.database.call("get_discussions_by_author_before_date", [
    SNAPS_CONTAINER_AUTHOR,
    "",
    new Date().toISOString().split(".")[0],
    1,
  ])) as Array<{ permlink: string }>;
  if (!result?.[0]?.permlink) throw new Error("Could not fetch peak.snaps container");
  return result[0].permlink;
}

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
    const account = process.env.HIVE_POSTING_ACCOUNT;
    const key = process.env.HIVE_POSTING_KEY;
    if (!account || !key) {
      return { ok: false, error: "HIVE_POSTING_ACCOUNT or HIVE_POSTING_KEY not set" };
    }
    const text = await getTweetText(runId, tweetIndex);

    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);

    const parentPermlink = await getLatestSnapsContainerPermlink(client);
    const permlink = snapPermlink();

    // Pull any image URLs out of the body so Hive frontends can render them
    // properly. Both markdown (![](url)) and bare image URLs are detected.
    const imageUrls = [
      ...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g),
    ]
      .map((m) => m[1])
      .concat(text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/gi) ?? []);

    const metadata = {
      app: "Marketing Portal Skatehive",
      tags: [HIVE_COMMUNITY_TAG, "snaps"],
      images: [...new Set(imageUrls)],
    };
    // Snap = COMMENT under peak.snaps' daily container.
    // SkateHive frontends filter these by json_metadata.tags including hive-173115.
    // Empty title is correct for snaps.
    const op = [
      "comment",
      {
        parent_author: SNAPS_CONTAINER_AUTHOR,
        parent_permlink: parentPermlink,
        author: account,
        permlink,
        title: "",
        body: text,
        json_metadata: JSON.stringify(metadata),
      },
    ] as const;

    const pk = PrivateKey.fromString(key);
    await client.broadcast.sendOperations([op as never], pk);

    const url = `https://skatehive.app/post/${account}/${permlink}`;
    const tweetStates = await recordPublish(runId, tweetIndex, "hive", {
      at: new Date().toISOString(),
      url,
      ref: permlink,
    });
    return { ok: true, url, tweetStates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishTweetToFarcaster(
  runId: string,
  tweetIndex: number,
): Promise<{ ok: boolean; url?: string; tweetStates?: TweetStateMap; error?: string }> {
  try {
    const apiKey = process.env.NEYNAR_API_KEY;
    const signerUuid = process.env.NEYNAR_SIGNER_UUID;
    if (!apiKey || !signerUuid) {
      return { ok: false, error: "NEYNAR_API_KEY or NEYNAR_SIGNER_UUID not set" };
    }
    const text = await getTweetText(runId, tweetIndex);

    // Extract URL embeds so Warpcast renders rich previews.
    // skatehive.app URLs become Mini App / Frame embeds via the page's
    // frame meta tags; image URLs render inline. Neynar accepts up to 2
    // URL embeds per cast.
    const urlMatches = text.match(/https?:\/\/[^\s)]+[^\s.,;:!?)]/g) ?? [];
    const priority = (u: string): number => {
      if (u.includes("skatehive.app")) return 0;
      if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)) return 1;
      return 2;
    };
    const embedUrls = [...new Set(urlMatches)]
      .sort((a, b) => priority(a) - priority(b))
      .slice(0, 2);
    const embeds = embedUrls.map((url) => ({ url }));

    const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        signer_uuid: signerUuid,
        text,
        channel_id: FC_CHANNEL_ID,
        ...(embeds.length > 0 ? { embeds } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Neynar HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const payload = (await res.json()) as {
      cast?: { hash?: string; author?: { username?: string } };
    };
    const hash = payload.cast?.hash;
    if (!hash) return { ok: false, error: "Neynar returned no cast hash" };
    const author = payload.cast?.author?.username ?? "skatehive";
    const url = `https://warpcast.com/${author}/${hash.slice(0, 10)}`;
    const tweetStates = await recordPublish(runId, tweetIndex, "farcaster", {
      at: new Date().toISOString(),
      url,
      ref: hash,
    });
    return { ok: true, url, tweetStates };
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

const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export async function uploadDraftImage(
  formData: FormData,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file provided" };

    const MAX = 8 * 1024 * 1024; // 8MB — generous for tweets
    if (file.size > MAX) {
      return { ok: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB; max 8MB)` };
    }
    if (!/^image\//.test(file.type)) {
      return { ok: false, error: `Unsupported type ${file.type}` };
    }

    const jwt = process.env.PINATA_JWT;
    if (!jwt) return { ok: false, error: "PINATA_JWT not set" };

    const upload = new FormData();
    upload.append("file", file, file.name);
    upload.append(
      "pinataMetadata",
      JSON.stringify({ name: `portal-skatehive-${Date.now()}-${file.name}` }),
    );

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: upload,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const payload = (await res.json()) as { IpfsHash?: string };
    if (!payload.IpfsHash) return { ok: false, error: "Pinata returned no IpfsHash" };

    return { ok: true, url: `${PINATA_GATEWAY}/${payload.IpfsHash}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
