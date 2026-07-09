"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { fetchTopSkatehivePosts } from "@/lib/skatehive-content";
import { hydrateMagazinePosts } from "@/lib/magazine";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

async function gate() {
  const project = await getActiveProject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const who = await authorize(token, project);
  if (!who) return { project, who: null as null };
  return { project, who };
}

export type CuratorPost = {
  id: string; // MagazineIssuePost row id
  author: string;
  permlink: string;
  order: number;
  blurb: string | null;
  featured: boolean;
  title: string;
  thumbnail: string | null;
};

export type CuratorIssue = {
  id: string;
  number: number;
  title: string;
  coverUrl: string | null;
  status: string;
  posts: CuratorPost[];
};

/** The issue the curator edits: the latest DRAFT for this project, created if the
 *  latest issue is already published (or none exists). */
async function getOrCreateDraft(projectSlug: string, username: string) {
  const latest = await prisma.magazineIssue.findFirst({
    where: { projectSlug },
    orderBy: { number: "desc" },
    include: { posts: { orderBy: { order: "asc" } } },
  });
  if (latest && latest.status === "draft") return latest;
  const nextNumber = (latest?.number ?? 0) + 1;
  return prisma.magazineIssue.create({
    data: {
      projectSlug,
      number: nextNumber,
      title: `Magazine #${nextNumber}`,
      updatedBy: username,
    },
    include: { posts: { orderBy: { order: "asc" } } },
  });
}

/** Load the editable issue + hydrate its posts' titles/thumbnails for the UI. */
export async function getCuratorIssue(): Promise<Ok<{ issue: CuratorIssue }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const issue = await getOrCreateDraft(project.slug, who.username);
  const hydrated = await hydrateMagazinePosts(
    issue.posts.map((p) => ({ author: p.author, permlink: p.permlink })),
    project.hive.frontend,
  );
  const byKey = new Map(hydrated.map((h) => [`${h.author}/${h.permlink}`, h]));
  const posts: CuratorPost[] = issue.posts.map((p) => {
    const h = byKey.get(`${p.author}/${p.permlink}`);
    return {
      id: p.id,
      author: p.author,
      permlink: p.permlink,
      order: p.order,
      blurb: p.blurb,
      featured: p.featured,
      title: h?.title ?? `@${p.author}/${p.permlink}`,
      thumbnail: h?.thumbnail ?? null,
    };
  });
  return { ok: true, issue: { id: issue.id, number: issue.number, title: issue.title, coverUrl: issue.coverUrl, status: issue.status, posts } };
}

/** Recent community posts to pick from (same source the old flipbook used). */
export async function listCandidatePosts(): Promise<Ok<{ candidates: { author: string; permlink: string; title: string; thumbnail: string | null; votes: number }[] }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  try {
    const posts = await fetchTopSkatehivePosts({
      daysBack: 30,
      limit: 20,
      communityTag: project.hive.community,
      frontendUrl: project.hive.frontend,
    });
    return {
      ok: true,
      candidates: posts.map((p) => ({ author: p.author, permlink: p.permlink, title: p.title, thumbnail: p.firstImage, votes: p.netVotes })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao buscar posts." };
  }
}

/** Parse "@author/permlink", "author/permlink", or a frontend post URL. */
function parseRef(input: string): { author: string; permlink: string } | null {
  const s = input.trim();
  const url = s.match(/@([a-z0-9.-]+)\/([a-z0-9-]+)\/?(?:$|\?|#)/i);
  if (url) return { author: url[1].toLowerCase(), permlink: url[2].toLowerCase() };
  const plain = s.replace(/^@/, "").match(/^([a-z0-9.-]+)\/([a-z0-9-]+)$/i);
  if (plain) return { author: plain[1].toLowerCase(), permlink: plain[2].toLowerCase() };
  return null;
}

export async function addMagazinePost(ref: { author: string; permlink: string } | string): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const parsed = typeof ref === "string" ? parseRef(ref) : ref;
  if (!parsed) return { ok: false, error: "Ref inválida — use @autor/permlink ou a URL do post." };
  const issue = await getOrCreateDraft(project.slug, who.username);
  const max = await prisma.magazineIssuePost.aggregate({ where: { issueId: issue.id }, _max: { order: true } });
  try {
    await prisma.magazineIssuePost.create({
      data: { issueId: issue.id, author: parsed.author, permlink: parsed.permlink, order: (max._max.order ?? -1) + 1 },
    });
  } catch {
    return { ok: false, error: "Esse post já está na edição." };
  }
  revalidatePath("/magazine");
  return { ok: true };
}

export async function removeMagazinePost(postId: string): Promise<{ ok: true } | Err> {
  const { who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  await prisma.magazineIssuePost.delete({ where: { id: postId } }).catch(() => {});
  revalidatePath("/magazine");
  return { ok: true };
}

export async function reorderMagazinePosts(orderedIds: string[]): Promise<{ ok: true } | Err> {
  const { who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  await prisma.$transaction(orderedIds.map((id, i) => prisma.magazineIssuePost.update({ where: { id }, data: { order: i } })));
  revalidatePath("/magazine");
  return { ok: true };
}

export async function setMagazineIssueMeta(input: { title?: string; coverUrl?: string | null }): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const issue = await getOrCreateDraft(project.slug, who.username);
  await prisma.magazineIssue.update({
    where: { id: issue.id },
    data: {
      title: input.title?.trim() || undefined,
      coverUrl: input.coverUrl === undefined ? undefined : input.coverUrl?.trim() || null,
      updatedBy: who.username,
    },
  });
  revalidatePath("/magazine");
  return { ok: true };
}

/** Publish the draft issue → the public /api/magazine/current serves the latest published. */
export async function publishMagazineIssue(): Promise<Ok<{ number: number }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const issue = await getOrCreateDraft(project.slug, who.username);
  const count = await prisma.magazineIssuePost.count({ where: { issueId: issue.id } });
  if (count === 0) return { ok: false, error: "Adicione ao menos um post antes de publicar." };
  await prisma.magazineIssue.update({
    where: { id: issue.id },
    data: { status: "published", publishedAt: new Date(), updatedBy: who.username },
  });
  revalidatePath("/magazine");
  return { ok: true, number: issue.number };
}
