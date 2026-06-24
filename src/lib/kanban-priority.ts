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
