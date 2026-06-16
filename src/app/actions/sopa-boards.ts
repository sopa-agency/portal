"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";

// ---------------------------------------------------------------------------
// SOPA editable boards — shared CRUD for the org-chart flowchart and the
// portfolio. Both are SOPA-only; every action asserts the active project is
// SOPA so another portal can never read or mutate these rows.
// ---------------------------------------------------------------------------

export type BoardKind = "orgchart" | "portfolio";

export type BoardCard = {
  id: string;
  board: string;
  parentId: string | null;
  title: string;
  body: string | null;
  logoUrl: string | null;
  order: number;
};

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
  return {
    id: r.id,
    board: r.board,
    parentId: r.parentId,
    title: r.title,
    body: r.body,
    logoUrl: typeof meta.logoUrl === "string" ? meta.logoUrl : null,
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

export async function createCard(input: {
  board: BoardKind;
  parentId?: string | null;
  title: string;
  body?: string;
  logoUrl?: string;
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
      meta: input.logoUrl ? { logoUrl: input.logoUrl } : Prisma.JsonNull,
      order: siblings,
    },
  });
  revalidatePath(input.board === "orgchart" ? "/org-chart" : "/portfolio");
  return toCard(row);
}

export async function updateCard(
  id: string,
  patch: { title?: string; body?: string; logoUrl?: string | null },
): Promise<BoardCard> {
  await assertSopa();
  const row = await prisma.sopaBoard.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || "Sem título" } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() || null } : {}),
      ...(patch.logoUrl !== undefined
        ? { meta: patch.logoUrl ? { logoUrl: patch.logoUrl } : Prisma.JsonNull }
        : {}),
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
