"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { brandEnv } from "@/lib/brand-env";
import { HIVE_NODES } from "@/lib/social-publish";
import { listSkatehiveVideos } from "@/app/actions/skatehive-media";
import { buildPostUrl } from "@/lib/skatehive-content";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { queueBoost } from "@/lib/boost-core";
import type { ProjectConfig } from "@/projects/types";
import { type BoostLevel, type BoostKind, type CurationSnap } from "@/lib/snap-curation-shared";

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, project, who };
}

const castHashOf = (author: string, permlink: string) => `hive:${author}/${permlink}`;
const postHashOf = (author: string, permlink: string) => `${author}/${permlink}`;

/**
 * Direct replies to a single post. Used on the write path to guarantee we never
 * post a second comment on a post our account already replied to.
 */
async function findAccountReply(
  account: string,
  author: string,
  permlink: string,
): Promise<{ author: string; permlink: string } | null> {
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "condenser_api.get_content_replies",
        params: [author, permlink],
        id: 1,
      }),
      cache: "no-store",
    });
    const replies = ((await res.json()) as { result?: Array<{ author: string; permlink: string }> }).result ?? [];
    return replies.find((r) => r.author === account) ?? null;
  } catch {
    // On RPC failure, don't block posting — the caller decides. (List detection
    // is best-effort; the write guard treats a failure as "unknown".)
    return null;
  }
}

/**
 * Which of the given target posts our account has already replied to. One RPC
 * call: the account's recent comments carry parent_author/parent_permlink, so
 * we can mark a whole inbox page as "already commented" without 40 lookups.
 * Returns a map of "author/permlink" → our reply URL.
 */
async function repliedTargets(
  account: string,
  targets: { author: string; permlink: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!account || targets.length === 0) return out;
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "bridge.get_account_posts",
        params: { sort: "comments", account, limit: 100 },
        id: 1,
      }),
      cache: "no-store",
    });
    const comments =
      ((await res.json()) as {
        result?: Array<{ author: string; permlink: string; parent_author?: string; parent_permlink?: string }>;
      }).result ?? [];
    const wanted = new Set(targets.map((t) => postHashOf(t.author, t.permlink)));
    for (const c of comments) {
      if (!c.parent_author || !c.parent_permlink) continue;
      const parentHash = postHashOf(c.parent_author, c.parent_permlink);
      if (wanted.has(parentHash) && !out.has(parentHash)) {
        out.set(parentHash, `https://peakd.com/@${c.author}/${c.permlink}`);
      }
    }
  } catch {
    // best-effort — an empty map just means the UI won't pre-mark cards.
  }
  return out;
}

/** Recent SkateHive snaps for the curation inbox, with any boost status. */
export async function listSnapsForCuration(force = false): Promise<
  { ok: true; snaps: CurationSnap[]; project: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;

  // images: true — plenty of snaps are a photo or a GIF, not a clip.
  const res = await listSkatehiveVideos(null, { force, images: true });
  if (!res.ok) return res;
  // One card per snap post (a post can yield several media entries → dedupe,
  // keeping the first clip/photo as the thumbnail).
  const seen = new Set<string>();
  const snaps = res.videos
    .filter((v) => v.source === "snap")
    .filter((v) => {
      const k = `${v.author}/${v.permlink}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    // Most-recent first — a curation inbox should surface FRESH snaps, not the
    // highest-voted (the vote sort buried new 0-vote snaps below the cut).
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, 40);

  const hashes = snaps.map((s) => castHashOf(s.author, s.permlink));
  const account = brandEnv(g.project, "HIVE_POSTING_ACCOUNT");
  const [targets, replied] = await Promise.all([
    prisma.trailBoostTarget.findMany({ where: { castHash: { in: hashes } } }).catch(() => []),
    account ? repliedTargets(account, snaps.map((s) => ({ author: s.author, permlink: s.permlink }))) : Promise.resolve(new Map<string, string>()),
  ]);
  const byHash = new Map(targets.map((t) => [t.castHash, t]));

  return {
    ok: true,
    project: g.project.name,
    snaps: snaps.map((s) => {
      const t = byHash.get(castHashOf(s.author, s.permlink));
      const replyUrl = replied.get(postHashOf(s.author, s.permlink)) ?? null;
      return {
        id: `${s.author}/${s.permlink}`,
        author: s.author,
        permlink: s.permlink,
        title: s.title,
        votes: s.votes,
        payout: s.payout,
        url: `https://peakd.com/@${s.author}/${s.permlink}`,
        thumbnail: s.url, // clip (first frame as reference) or photo/GIF
        kind: s.kind,
        created: s.created,
        boost: t ? { budget: t.budget, released: t.released, status: t.status } : null,
        replied: !!replyUrl,
        replyUrl,
      };
    }),
  };
}

/** Recent top-level blog/magazine posts from the project's Hive community,
 * with any boost status. Same reply/boost actions as snaps (generic Hive post). */
export async function listBlogPostsForCuration(): Promise<
  { ok: true; posts: CurationSnap[]; project: string; canParagraph: boolean } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const community = g.project.hive.community;
  if (!community) return { ok: false, error: "Sem comunidade Hive configurada neste portal." };

  let raw: HiveRankedPost[];
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "bridge.get_ranked_posts", params: { sort: "created", tag: community, limit: 20, observer: "" }, id: 1 }),
      cache: "no-store",
    });
    raw = ((await res.json()) as { result?: HiveRankedPost[] }).result ?? [];
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao buscar posts da Hive." };
  }

  const frontend = g.project.hive.frontend;
  const hashes = raw.map((p) => castHashOf(p.author, p.permlink));
  const account = brandEnv(g.project, "HIVE_POSTING_ACCOUNT");
  const [targets, replied] = await Promise.all([
    prisma.trailBoostTarget.findMany({ where: { castHash: { in: hashes } } }).catch(() => []),
    account ? repliedTargets(account, raw.map((p) => ({ author: p.author, permlink: p.permlink }))) : Promise.resolve(new Map<string, string>()),
  ]);
  const byHash = new Map(targets.map((t) => [t.castHash, t]));

  const posts: CurationSnap[] = raw.map((p) => {
    let meta: { image?: string[] } = {};
    try {
      meta = typeof p.json_metadata === "string" ? JSON.parse(p.json_metadata) : (p.json_metadata ?? {});
    } catch {
      meta = {};
    }
    const t = byHash.get(castHashOf(p.author, p.permlink));
    const replyUrl = replied.get(postHashOf(p.author, p.permlink)) ?? null;
    return {
      id: `${p.author}/${p.permlink}`,
      author: p.author,
      permlink: p.permlink,
      title: p.title || "(sem título)",
      votes: p.stats?.total_votes ?? p.net_votes ?? 0,
      payout: parseFloat(p.pending_payout_value ?? "0") || 0,
      url: buildPostUrl(p.author, p.permlink, frontend),
      thumbnail: meta.image?.[0] ?? "",
      kind: "image",
      created: p.created ?? "",
      boost: t ? { budget: t.budget, released: t.released, status: t.status } : null,
      replied: !!replyUrl,
      replyUrl,
    };
  });
  return { ok: true, posts, project: g.project.name, canParagraph: true };
}

/**
 * Pull a Hive post and shape the exact payload that goes to Paragraph
 * (title, markdown body with attribution, cover). Shared by the preview wall
 * and the send action so what you preview is byte-for-byte what gets posted.
 */
async function buildParagraphPayload(
  project: ProjectConfig,
  author: string,
  permlink: string,
): Promise<{ ok: true; title: string; markdown: string; imageUrl?: string; sourceUrl: string } | { ok: false; error: string }> {
  let post: { title?: string; body?: string; json_metadata?: string };
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_content", params: [author, permlink], id: 1 }),
      cache: "no-store",
    });
    post = ((await res.json()) as { result?: typeof post }).result ?? {};
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao buscar o post na Hive." };
  }
  if (!post.body?.trim()) return { ok: false, error: "Post sem corpo / não encontrado." };

  let imageUrl: string | undefined;
  try {
    const meta = JSON.parse(post.json_metadata ?? "{}") as { image?: string[] };
    imageUrl = meta.image?.[0];
  } catch { /* no cover */ }

  const sourceUrl = buildPostUrl(author, permlink, project.hive.frontend);
  const markdown = `${post.body.trim()}\n\n---\n*Originalmente publicado por @${author} na Hive — [ver original](${sourceUrl}).*`;
  return { ok: true, title: (post.title || `@${author}`).slice(0, 200), markdown, imageUrl, sourceUrl };
}

/**
 * Build the confirmation preview for the Paragraph publish wall: exactly what
 * will be posted (title, cover, body markdown) plus the email blast radius
 * (publication + active subscriber count). Read-only.
 */
export async function previewBlogPostForParagraph(
  author: string,
  permlink: string,
): Promise<
  | { ok: true; title: string; markdown: string; imageUrl?: string; sourceUrl: string; publication: string; publicationSlug: string; subscribers: number }
  | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;

  const { paragraphApiKey, getPublication, getSubscriberCount } = await import("@/lib/paragraph");
  const apiKey = paragraphApiKey(g.project);
  if (!apiKey) return { ok: false, error: "Paragraph não conectado neste portal (falta API key)." };

  const payload = await buildParagraphPayload(g.project, author, permlink);
  if (!payload.ok) return payload;

  const pub = await getPublication(apiKey).catch(() => null);
  const subscribers = pub ? await getSubscriberCount(pub.id).catch(() => 0) : 0;

  return {
    ok: true,
    title: payload.title,
    markdown: payload.markdown,
    imageUrl: payload.imageUrl,
    sourceUrl: payload.sourceUrl,
    publication: pub?.name ?? "Paragraph",
    publicationSlug: pub?.slug ?? "",
    subscribers,
  };
}

/**
 * Send a Hive blog post to the portal's Paragraph publication.
 * Open to any allowlisted portal member (session-gated).
 *
 * Two orthogonal switches:
 *   - publish: false → draft (invisible), true → published (live on the web).
 *   - sendNewsletter: emails ALL active subscribers (only meaningful when
 *     publishing). Default false; gated behind the confirmation wall in the UI.
 */
export async function sendBlogPostToParagraph(
  author: string,
  permlink: string,
  opts?: { publish?: boolean; sendNewsletter?: boolean },
): Promise<{ ok: true; url: string; id: string; published: boolean; emailed: boolean } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const publish = opts?.publish === true;
  // Email only ever goes out on a real publish.
  const sendNewsletter = publish && opts?.sendNewsletter === true;

  const { paragraphApiKey, createPost, getPublication } = await import("@/lib/paragraph");
  const apiKey = paragraphApiKey(g.project);
  if (!apiKey) return { ok: false, error: "Paragraph não conectado neste portal (falta API key)." };

  const payload = await buildParagraphPayload(g.project, author, permlink);
  if (!payload.ok) return payload;

  try {
    const created = await createPost(apiKey, {
      title: payload.title,
      markdown: payload.markdown,
      imageUrl: payload.imageUrl,
      status: publish ? "published" : "draft",
      sendNewsletter,
    });
    const pub = await getPublication(apiKey).catch(() => null);
    const url = pub ? `https://paragraph.com/@${pub.slug}/${created.id}` : `https://paragraph.com`;
    return { ok: true, url, id: created.id, published: publish, emailed: sendNewsletter };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `Falha ao ${publish ? "publicar" : "criar o draft"} no Paragraph.` };
  }
}

type HiveRankedPost = {
  author: string;
  permlink: string;
  title?: string;
  created?: string;
  net_votes?: number;
  stats?: { total_votes?: number };
  pending_payout_value?: string;
  json_metadata?: string | { image?: string[] };
};

/** Reply to a snap as this portal's Hive account (HITL — never automatic). */
export async function replyToSnap(
  author: string,
  permlink: string,
  body: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const text = body.trim();
  if (!text) return { ok: false, error: "Resposta vazia." };

  const account = brandEnv(g.project, "HIVE_POSTING_ACCOUNT");
  const key = brandEnv(g.project, "HIVE_POSTING_KEY");
  if (!account || !key) return { ok: false, error: "Hive não conectado neste portal (falta posting key)." };

  // Definitive duplicate guard — never post a second comment on a post this
  // account already replied to (stale UI, double-click, or two operators).
  const existing = await findAccountReply(account, author, permlink);
  if (existing) {
    return { ok: false, error: `@${account} já comentou neste post.` };
  }

  const childPermlink = `re-${permlink}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 255);
  try {
    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);
    await client.broadcast.sendOperations(
      [
        [
          "comment",
          {
            parent_author: author,
            parent_permlink: permlink,
            author: account,
            permlink: childPermlink,
            title: "",
            body: text,
            json_metadata: JSON.stringify({ app: `Marketing Portal ${g.project.name}`, tags: [g.project.hive.community ?? "hive"] }),
          },
        ] as never,
      ],
      PrivateKey.fromString(key),
    );
    return { ok: true, url: `https://peakd.com/@${account}/${childPermlink}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao comentar no Hive." };
  }
}

// ---------------------------------------------------------------------------
// AI reply suggestion — a short, human, on-brand draft for a snap or blog post.
// ---------------------------------------------------------------------------

const AI_TIMEOUT_MS = 30_000;

function hiveReplyPrompt(project: ProjectConfig, kind: "snap" | "blog", author: string, title: string): string {
  const voice = project.socials.find((s) => s.voice)?.voice ?? `${project.name}'s authentic, culture-native voice`;
  const noun = kind === "blog" ? "blog post" : "snap (short skate clip)";
  return `You are commenting on a community member's ${noun} on Hive, as ${project.name} — but sound like a REAL person in the skate scene, NOT a brand or a marketer.

${project.name}'s vibe (reference, don't imitate corporate tone): ${voice}

By @${author}${title ? `, about: "${title}"` : ""}.

Rules:
- Reply in the SAME language as the context (likely pt-BR or en).
- VERY short — one line, usually under 80 chars. React genuinely (hype the trick / spot / post).
- Human, casual, supportive. Lowercase is fine. At most one emoji. No hashtags, no marketing words.

Output ONLY the reply text, nothing else.`;
}

export async function generateHivePostReply(input: {
  author: string;
  title: string;
  kind: "snap" | "blog";
}): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const raw = await callOpenClaw(hiveReplyPrompt(g.project, input.kind, input.author, input.title), g.project.agent.id, {
      timeoutMs: AI_TIMEOUT_MS,
      project: g.project,
    });
    return { ok: true, draft: raw.trim().replace(/^["']|["']$/g, "").slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na IA." };
  }
}

// ---------------------------------------------------------------------------
// Boost — queue a subset of the SkateHive userbase to upvote this snap. The
// existing Pool B worker (trail-userbase-boost) drains the queue proportionally
// to real upvote growth, spaced with random pauses (organic pacing).
// ---------------------------------------------------------------------------

export async function boostSnap(
  author: string,
  permlink: string,
  level: BoostLevel,
  baselineVotes = 0,
  kind: BoostKind = "snap",
  mode: "organic" | "direct" = "organic",
): Promise<{ ok: true; queued: number; budget: number } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  return queueBoost({ author, permlink, level, baselineVotes, kind, mode });
}
