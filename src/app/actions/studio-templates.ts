"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";

export type StudioTemplateMeta = { id: string; name: string; kind: string; updatedAt: string };

async function gate() {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, username: session.username };
}

/** Templates saved for the active project (name + meta only). */
export async function listStudioTemplates(): Promise<
  { ok: true; templates: StudioTemplateMeta[] } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const rows = await prisma.studioTemplate
    .findMany({ where: { projectSlug: g.project.slug }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, kind: true, updatedAt: true } })
    .catch(() => []);
  return { ok: true, templates: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, updatedAt: r.updatedAt.toISOString() })) };
}

/** Save (or overwrite by name) a template — the whole carousel doc as JSON. */
export async function saveStudioTemplate(
  name: string,
  doc: unknown,
  kind = "design",
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const n = name.trim().slice(0, 80);
  if (!n) return { ok: false, error: "Dê um nome ao template." };
  if (!doc || typeof doc !== "object") return { ok: false, error: "Documento inválido." };
  try {
    const row = await prisma.studioTemplate.upsert({
      where: { projectSlug_name: { projectSlug: g.project.slug, name: n } },
      update: { doc: doc as object, kind, createdBy: g.username },
      create: { projectSlug: g.project.slug, name: n, doc: doc as object, kind, createdBy: g.username },
    });
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao salvar." };
  }
}

/** Load one template's full doc. */
export async function getStudioTemplate(
  id: string,
): Promise<{ ok: true; name: string; doc: unknown } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.studioTemplate.findUnique({ where: { id } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Template não encontrado." };
  return { ok: true, name: row.name, doc: row.doc };
}

export async function deleteStudioTemplate(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.studioTemplate.findUnique({ where: { id } });
  if (!row || row.projectSlug !== g.project.slug) return { ok: false, error: "Template não encontrado." };
  await prisma.studioTemplate.delete({ where: { id } });
  return { ok: true };
}
