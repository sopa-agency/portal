// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { DEF, type ElKey } from "./tokens";
import type { Card } from "./schema";

export type Pos = { x: number; y: number; w: number; h?: number; fontSize?: number };

// posição efetiva de um elemento singleton = default + override persistido em card.layout
export function elPos(card: Card, key: ElKey): Pos {
  return { ...DEF[key], ...((card.layout as Record<string, Partial<Pos>>)?.[key] ?? {}) } as Pos;
}

export function withLayout(card: Card, key: ElKey, patch: Partial<Pos>): Card {
  return { ...card, layout: { ...card.layout, [key]: { ...(card.layout?.[key] ?? {}), ...patch } } } as Card;
}

export function resetLayout(card: Card): Card {
  const blocos = card.blocos.map((b, i) => ({ ...b, x: 90, y: 880 + i * 20, w: 900 }));
  return { ...card, layout: {}, blocos } as Card;
}
