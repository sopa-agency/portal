// Shared ranking for GitHub Project "Priority" single-select values.
// Lower number = higher priority; unset sorts last. Handles P0–P3 and
// Urgent/High/Medium/Low (+ PT variants). Pure + framework-agnostic so both
// server actions and client components can use it.
export function priorityRank(p?: string): number {
  if (!p) return 99;
  const s = p.toLowerCase();
  const pn = s.match(/\bp\s*(\d)\b/); // P0, P1, P2…
  if (pn) return Number(pn[1]);
  if (/urgent|critical|cr[ií]tic/.test(s)) return 0;
  if (/high|alta/.test(s)) return 1;
  if (/med/.test(s)) return 2;
  if (/low|baixa/.test(s)) return 3;
  return 90; // known-but-unrecognized value, still before "no priority"
}

/**
 * Sort comparator for cards across every surface (For You, SOPA board, agenda).
 * Order: fire priority points DESC (5🔥 first) → soonest deadline first (none
 * last) → GitHub priority rank. Use with Array.sort.
 */
export function compareByPriority(
  a: { firePriority?: number; deadline?: string; priority?: string },
  b: { firePriority?: number; deadline?: string; priority?: string },
): number {
  const fp = (b.firePriority ?? 0) - (a.firePriority ?? 0);
  if (fp) return fp;
  const ad = a.deadline ? Date.parse(a.deadline) : Infinity;
  const bd = b.deadline ? Date.parse(b.deadline) : Infinity;
  if (ad !== bd) return ad - bd;
  return priorityRank(a.priority) - priorityRank(b.priority);
}
