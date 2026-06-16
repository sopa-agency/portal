"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPinataSignedUploadUrl } from "@/lib/social-publish";
import { getActiveProject } from "@/projects/index";

// ---------------------------------------------------------------------------
// SOPA editable boards — shared CRUD for the org-chart flowchart and the
// portfolio. Both are SOPA-only; every action asserts the active project is
// SOPA so another portal can never read or mutate these rows.
// ---------------------------------------------------------------------------

export type BoardKind = "orgchart" | "portfolio";

export type TeamMember = { role: string; username: string };

export type BoardCard = {
  id: string;
  board: string;
  parentId: string | null;
  title: string;
  body: string | null;
  logoUrl: string | null;
  /** org-chart only: engagement tier id ("pontual" | "operacao" | "motor"). */
  tier: string | null;
  /** org-chart only: assigned roles → person. */
  team: TeamMember[];
  order: number;
};

/** Patchable fields stored inside the meta JSON blob. */
type MetaPatch = {
  logoUrl?: string | null;
  tier?: string | null;
  team?: TeamMember[];
};

/** Merge meta patches onto the existing blob so updating one key never wipes the
 *  others (logo vs tier vs team are edited from different places). Returns
 *  Prisma.JsonNull when nothing is left so the column clears cleanly. */
function mergeMeta(
  current: Prisma.JsonValue | undefined,
  patch: MetaPatch,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const base: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  if (patch.logoUrl !== undefined) {
    if (patch.logoUrl) base.logoUrl = patch.logoUrl;
    else delete base.logoUrl;
  }
  if (patch.tier !== undefined) {
    if (patch.tier) base.tier = patch.tier;
    else delete base.tier;
  }
  if (patch.team !== undefined) {
    const clean = patch.team.filter((m) => m.username.trim());
    if (clean.length)
      base.team = clean.map((m) => ({ role: m.role, username: m.username.trim() }));
    else delete base.team;
  }
  return Object.keys(base).length ? (base as Prisma.InputJsonValue) : Prisma.JsonNull;
}

async function assertSopa() {
  const project = await getActiveProject();
  if (project.slug !== "sopa") {
    throw new Error("Boards are only available on the SOPA portal.");
  }
}

function toCard(r: {
  id: string;
  board: string;
  parentId: string | null;
  title: string;
  body: string | null;
  meta: Prisma.JsonValue;
  order: number;
}): BoardCard {
  const meta =
    r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)
      ? (r.meta as Record<string, unknown>)
      : {};
  const team: TeamMember[] = Array.isArray(meta.team)
    ? (meta.team as unknown[])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        // `name` fallback keeps any early free-text entries working.
        .map((m) => ({
          role: String(m.role ?? ""),
          username: String(m.username ?? m.name ?? ""),
        }))
        .filter((m) => m.role && m.username)
    : [];
  return {
    id: r.id,
    board: r.board,
    parentId: r.parentId,
    title: r.title,
    body: r.body,
    logoUrl: typeof meta.logoUrl === "string" ? meta.logoUrl : null,
    tier: typeof meta.tier === "string" ? meta.tier : null,
    team,
    order: r.order,
  };
}

/** All cards for a board, ordered. Seeds the org-chart with SOPA → Reelflip +
 *  Blockwire on first load so the page is never empty. */
export async function listBoard(board: BoardKind): Promise<BoardCard[]> {
  await assertSopa();
  let rows = await prisma.sopaBoard.findMany({
    where: { board },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  if (rows.length === 0 && board === "orgchart") {
    const root = await prisma.sopaBoard.create({
      data: { board, parentId: null, title: "SOPA", order: 0 },
    });
    await prisma.sopaBoard.createMany({
      data: [
        { board, parentId: root.id, title: "Reelflip", order: 0 },
        { board, parentId: root.id, title: "Blockwire", order: 1 },
      ],
    });
    rows = await prisma.sopaBoard.findMany({
      where: { board },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
  }

  return rows.map(toCard);
}

/** Signed-URL handshake for a direct browser→Pinata logo upload, gated to SOPA.
 *  Mirrors signPostMediaUpload but without the Post Creator requirement (SOPA
 *  has no Post Creator, so that action's authGate would reject it). */
export async function signSopaLogoUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    await assertSopa();
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createCard(input: {
  board: BoardKind;
  parentId?: string | null;
  title: string;
  body?: string;
  logoUrl?: string;
  tier?: string | null;
  team?: TeamMember[];
}): Promise<BoardCard> {
  await assertSopa();
  const title = input.title.trim() || "Sem título";
  // Append to the end of its sibling group.
  const siblings = await prisma.sopaBoard.count({
    where: { board: input.board, parentId: input.parentId ?? null },
  });
  const row = await prisma.sopaBoard.create({
    data: {
      board: input.board,
      parentId: input.parentId ?? null,
      title,
      body: input.body?.trim() || null,
      meta: mergeMeta(undefined, {
        logoUrl: input.logoUrl,
        tier: input.tier,
        team: input.team,
      }),
      order: siblings,
    },
  });
  revalidatePath(input.board === "orgchart" ? "/org-chart" : "/portfolio");
  return toCard(row);
}

export async function updateCard(
  id: string,
  patch: { title?: string; body?: string } & MetaPatch,
): Promise<BoardCard> {
  await assertSopa();
  const touchesMeta =
    patch.logoUrl !== undefined || patch.tier !== undefined || patch.team !== undefined;
  const existing = touchesMeta
    ? await prisma.sopaBoard.findUnique({ where: { id }, select: { meta: true } })
    : null;
  const row = await prisma.sopaBoard.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || "Sem título" } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() || null } : {}),
      ...(touchesMeta ? { meta: mergeMeta(existing?.meta, patch) } : {}),
    },
  });
  revalidatePath(row.board === "orgchart" ? "/org-chart" : "/portfolio");
  return toCard(row);
}

/** Delete a card. For the org-chart, also removes the whole subtree so no
 *  orphaned descendants are left dangling. The SOPA root cannot be deleted. */
export async function deleteCard(id: string): Promise<{ deleted: string[] }> {
  await assertSopa();
  const target = await prisma.sopaBoard.findUnique({ where: { id } });
  if (!target) return { deleted: [] };

  if (target.board === "orgchart" && target.parentId === null) {
    throw new Error("The SOPA root cannot be deleted.");
  }

  const toDelete = [id];
  if (target.board === "orgchart") {
    // Walk descendants breadth-first.
    let frontier = [id];
    while (frontier.length) {
      const children = await prisma.sopaBoard.findMany({
        where: { board: "orgchart", parentId: { in: frontier } },
        select: { id: true },
      });
      const ids = children.map((c) => c.id);
      toDelete.push(...ids);
      frontier = ids;
    }
  }

  await prisma.sopaBoard.deleteMany({ where: { id: { in: toDelete } } });
  revalidatePath(target.board === "orgchart" ? "/org-chart" : "/portfolio");
  return { deleted: toDelete };
}
