"use server";

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import {
  emptyHomepageDoc,
  homepagePublishErrors,
  sanitizeHomepageDoc,
  type HomepageConfigDoc,
} from "@/lib/homepage-config";
import type { Prisma } from "@prisma/client";

// Team-gated server actions for the curated media-magazine homepage config.
// Mirrors src/app/actions/magazine.ts: one versioned row per project, latest
// published wins, draft seeded from the live config, preview via capability
// token, flip draft→published. Every export is async (build-verified).

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

async function gate() {
  const project = await getActiveProject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const who = await authorize(token, project);
  if (!who) return { project, who: null as null };
  return { project, who };
}

export type HomepageMeta = {
  id: string;
  version: number;
  status: string; // draft | published
  previewToken: string | null;
  publishedAt: string | null;
  updatedBy: string | null;
};

export type HomepageVersionSummary = {
  id: string;
  version: number;
  status: string;
  publishedAt: string | null;
  updatedBy: string | null;
  active: boolean; // the published version the public API currently serves
};

function metaOf(row: {
  id: string;
  version: number;
  status: string;
  previewToken: string | null;
  publishedAt: Date | null;
  updatedBy: string | null;
}): HomepageMeta {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    previewToken: row.previewToken,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
  };
}

/** Latest published version id (served at /api/homepage/current). */
async function activeVersionId(projectSlug: string): Promise<string | null> {
  const a = await prisma.homepageConfig.findFirst({
    where: { projectSlug, status: "published" },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    select: { id: true },
  });
  return a?.id ?? null;
}

/** Get the working draft — or create one seeded from the live published doc. */
export async function getHomepageDraft(): Promise<Ok<{ config: HomepageConfigDoc; meta: HomepageMeta }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };

  const latest = await prisma.homepageConfig.findFirst({
    where: { projectSlug: project.slug },
    orderBy: { version: "desc" },
  });

  let row = latest && latest.status === "draft" ? latest : null;
  if (!row) {
    // Seed a new draft from the latest published doc (or an empty doc).
    const published = await prisma.homepageConfig.findFirst({
      where: { projectSlug: project.slug, status: "published" },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    });
    const seed = sanitizeHomepageDoc(published?.data ?? emptyHomepageDoc());
    row = await prisma.homepageConfig.create({
      data: {
        projectSlug: project.slug,
        version: (latest?.version ?? 0) + 1,
        status: "draft",
        data: seed as unknown as Prisma.InputJsonValue,
        updatedBy: who.username,
      },
    });
  }
  return { ok: true, config: sanitizeHomepageDoc(row.data), meta: metaOf(row) };
}

/** All versions (active / drafts / old) for the version switcher. */
export async function listHomepageVersions(): Promise<Ok<{ versions: HomepageVersionSummary[]; activeId: string | null }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const [rows, activeId] = await Promise.all([
    prisma.homepageConfig.findMany({ where: { projectSlug: project.slug }, orderBy: { version: "desc" } }),
    activeVersionId(project.slug),
  ]);
  return {
    ok: true,
    activeId,
    versions: rows.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedBy: r.updatedBy,
      active: r.id === activeId,
    })),
  };
}

async function ownConfig(id: string, projectSlug: string): Promise<boolean> {
  const row = await prisma.homepageConfig.findFirst({ where: { id, projectSlug }, select: { id: true } });
  return !!row;
}

/** Load one version's doc for the editor / version switcher. */
export async function getHomepageVersion(id: string): Promise<Ok<{ config: HomepageConfigDoc; meta: HomepageMeta }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const row = await prisma.homepageConfig.findFirst({ where: { id, projectSlug: project.slug } });
  if (!row) return { ok: false, error: "Versão não encontrada." };
  return { ok: true, config: sanitizeHomepageDoc(row.data), meta: metaOf(row) };
}

/** Merge a partial patch into a version's doc (sections save independently). */
export async function saveHomepageSection(
  id: string,
  patch: Partial<HomepageConfigDoc>,
): Promise<Ok<{ config: HomepageConfigDoc }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownConfig(id, project.slug))) return { ok: false, error: "Versão não encontrada." };
  const row = await prisma.homepageConfig.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Versão não encontrada." };
  if (row.status === "published") return { ok: false, error: "Publicada — crie um rascunho para editar." };

  const current = sanitizeHomepageDoc(row.data);
  const merged = sanitizeHomepageDoc({ ...current, ...patch });
  await prisma.homepageConfig.update({
    where: { id },
    data: { data: merged as unknown as Prisma.InputJsonValue, updatedBy: who.username },
  });
  revalidatePath("/homepage");
  return { ok: true, config: merged };
}

/** Publish a draft (validates the design's minimums first). */
export async function publishHomepage(id: string): Promise<Ok<{ version: number }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const row = await prisma.homepageConfig.findFirst({ where: { id, projectSlug: project.slug } });
  if (!row) return { ok: false, error: "Versão não encontrada." };
  const doc = sanitizeHomepageDoc(row.data);
  const errs = homepagePublishErrors(doc);
  if (errs.length > 0) return { ok: false, error: errs.join(" ") };
  await prisma.homepageConfig.update({
    where: { id },
    data: { status: "published", publishedAt: new Date(), updatedBy: who.username },
  });
  revalidatePath("/homepage");
  return { ok: true, version: row.version };
}

/** Return a published version to draft (public API then serves the prior one). */
export async function unpublishHomepage(id: string): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownConfig(id, project.slug))) return { ok: false, error: "Versão não encontrada." };
  await prisma.homepageConfig.update({ where: { id }, data: { status: "draft", publishedAt: null, updatedBy: who.username } });
  revalidatePath("/homepage");
  return { ok: true };
}

/** Mint (or return) a preview capability token → sk3 /home?preview=<token>. */
export async function createHomepagePreviewToken(id: string): Promise<Ok<{ url: string; token: string }> | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  const row = await prisma.homepageConfig.findFirst({ where: { id, projectSlug: project.slug }, select: { id: true, previewToken: true } });
  if (!row) return { ok: false, error: "Versão não encontrada." };
  let token = row.previewToken;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    await prisma.homepageConfig.update({ where: { id }, data: { previewToken: token } });
  }
  const base = (project.hive?.frontend ?? "https://skatehive.app").replace(/\/$/, "");
  return { ok: true, token, url: `${base}/home?preview=${token}` };
}

/** Revoke a version's preview token. */
export async function revokeHomepagePreviewToken(id: string): Promise<{ ok: true } | Err> {
  const { project, who } = await gate();
  if (!who) return { ok: false, error: "Não autorizado." };
  if (!(await ownConfig(id, project.slug))) return { ok: false, error: "Versão não encontrada." };
  await prisma.homepageConfig.update({ where: { id }, data: { previewToken: null } });
  return { ok: true };
}
