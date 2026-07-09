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
  status: string; // draft | published
  publishedAt: string | null;
  posts: CuratorPost[];
};

export type IssueSummary = {
  id: string;
  number: number;
  title: string;
  status: string;
  publishedAt: string | null;
  postCount: number;
  active: boolean; // the published issue the public API currently serves
};

/** The latest DRAFT for a project, created if the latest issue is published (or none). */
async function getOrCreateDraft(projectSlug: string, username: string) {
  const latest = await prisma.magazineIssue.findFirst({
    where: { projectSlug },
    orderBy: { number: "desc" },
  });
  if (latest && latest.status === "draft") return latest.id;
  const nextNumber = (latest?.number ?? 0) + 1;
  const created = await prisma.magazineIssue.create({
    data: { projectSlug, number: nextNumber, title: `Magazine #${nextNumber}`, updatedBy: username },
  });
  return created.id;
}

/** Which published issue is "active" (served at /api/magazine/current): latest published. */
async function activeIssueId(projectSlug: string): Promise<string | null> {
  const a = await prisma.magazineIssue.findFirst({
    where: { projectSlug, status: "published" },
    orderBy: [{ publishedAt: "desc" }, { number: "desc" }],
    select: { id: true },
  });
  return a?.id ?? null;
}

/** List every issue (active / drafts / old) for the edition switcher. */
export async function listMagazineIssues(): Promise<Ok<{ issues: IssueSummary[]; activeId: string | null }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const [rows, activeId] = await Promise.all([
    prisma.magazineIssue.findMany({
      where: { projectSlug: project.slug },
      orderBy: { number: "desc" },
      include: { _count: { select: { posts: true } } },
    }),
    activeIssueId(project.slug),
  ]);
  return {
    ok: true,
    activeId,
    issues: rows.map((i) => ({
      id: i.id,
      number: i.number,
      title: i.title,
      status: i.status,
      publishedAt: i.publishedAt?.toISOString() ?? null,
      postCount: i._count.posts,
      active: i.id === activeId,
    })),
  };
}

/** Load one issue (hydrated) for the editor. Omit issueId → the working draft. */
export async function getCuratorIssue(issueId?: string): Promise<Ok<{ issue: CuratorIssue }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const id = issueId ?? (await getOrCreateDraft(project.slug, who.username));
  const issue = await prisma.magazineIssue.findFirst({
    where: { id, projectSlug: project.slug },
    include: { posts: { orderBy: { order: "asc" } } },
  });
  if (!issue) return { ok: false, error: "Edição não encontrada." };
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
  return {
    ok: true,
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      coverUrl: issue.coverUrl,
      status: issue.status,
      publishedAt: issue.publishedAt?.toISOString() ?? null,
      posts,
    },
  };
}

/** Start a fresh draft edition. */
export async function createDraftIssue(): Promise<Ok<{ issueId: string }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const latest = await prisma.magazineIssue.findFirst({ where: { projectSlug: project.slug }, orderBy: { number: "desc" }, select: { number: true } });
  const number = (latest?.number ?? 0) + 1;
  const created = await prisma.magazineIssue.create({
    data: { projectSlug: project.slug, number, title: `Magazine #${number}`, updatedBy: who.username },
  });
  revalidatePath("/magazine");
  return { ok: true, issueId: created.id };
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

/** Verify the issue belongs to the active project (guards the issueId param). */
async function ownIssue(issueId: string, projectSlug: string): Promise<boolean> {
  const n = await prisma.magazineIssue.count({ where: { id: issueId, projectSlug } });
  return n > 0;
}

export async function addMagazinePost(issueId: string, ref: { author: string; permlink: string } | string): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownIssue(issueId, project.slug))) return { ok: false, error: "Edição inválida." };
  const parsed = typeof ref === "string" ? parseRef(ref) : ref;
  if (!parsed) return { ok: false, error: "Ref inválida — use @autor/permlink ou a URL do post." };
  const max = await prisma.magazineIssuePost.aggregate({ where: { issueId }, _max: { order: true } });
  try {
    await prisma.magazineIssuePost.create({
      data: { issueId, author: parsed.author, permlink: parsed.permlink, order: (max._max.order ?? -1) + 1 },
    });
  } catch (e) {
    // P2002 = unique(issueId, author, permlink) → genuinely already added.
    if ((e as { code?: string })?.code === "P2002") return { ok: false, error: "Esse post já está na edição." };
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao adicionar." };
  }
  revalidatePath("/magazine");
  return { ok: true };
}

export async function removeMagazinePost(postId: string): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  // Only delete a row that belongs to one of this project's issues.
  await prisma.magazineIssuePost.deleteMany({ where: { id: postId, issue: { projectSlug: project.slug } } }).catch(() => {});
  revalidatePath("/magazine");
  return { ok: true };
}

export async function reorderMagazinePosts(issueId: string, orderedIds: string[]): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownIssue(issueId, project.slug))) return { ok: false, error: "Edição inválida." };
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.magazineIssuePost.updateMany({ where: { id, issueId }, data: { order: i } })),
  );
  revalidatePath("/magazine");
  return { ok: true };
}

export async function setMagazineIssueMeta(issueId: string, input: { title?: string; coverUrl?: string | null }): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownIssue(issueId, project.slug))) return { ok: false, error: "Edição inválida." };
  await prisma.magazineIssue.update({
    where: { id: issueId },
    data: {
      title: input.title?.trim() || undefined,
      coverUrl: input.coverUrl === undefined ? undefined : input.coverUrl?.trim() || null,
      updatedBy: who.username,
    },
  });
  revalidatePath("/magazine");
  return { ok: true };
}

/** Publish (or re-publish) an issue → it becomes the active one served publicly. */
export async function publishMagazineIssue(issueId: string): Promise<Ok<{ number: number }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownIssue(issueId, project.slug))) return { ok: false, error: "Edição inválida." };
  const count = await prisma.magazineIssuePost.count({ where: { issueId } });
  if (count === 0) return { ok: false, error: "Adicione ao menos um post antes de publicar." };
  const updated = await prisma.magazineIssue.update({
    where: { id: issueId },
    data: { status: "published", publishedAt: new Date(), updatedBy: who.username },
  });
  revalidatePath("/magazine");
  return { ok: true, number: updated.number };
}

/** Move a published issue back to draft (stops serving it publicly if it was active). */
export async function unpublishMagazineIssue(issueId: string): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownIssue(issueId, project.slug))) return { ok: false, error: "Edição inválida." };
  await prisma.magazineIssue.update({ where: { id: issueId }, data: { status: "draft", publishedAt: null, updatedBy: who.username } });
  revalidatePath("/magazine");
  return { ok: true };
}
