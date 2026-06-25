import { prisma } from "@/lib/prisma";

// Portal-owned per-card metadata (fire priority + deadline), loaded by item id.
// Shared by every surface that needs to show/sort by priority: the Kanban GET,
// the member-tasks feed (For You), the SOPA aggregated board, and the briefing
// context. Keeps the CardPriority read logic in one place.

export type CardMeta = { firePriority?: number; deadline?: string };

export async function loadCardMeta(itemIds: string[]): Promise<Map<string, CardMeta>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.cardPriority.findMany({ where: { itemId: { in: ids } } }).catch(() => []);
  return new Map(
    rows.map((r) => [
      r.itemId,
      {
        firePriority: r.priority || undefined,
        deadline: r.deadline ? r.deadline.toISOString().slice(0, 10) : undefined,
      },
    ]),
  );
}
