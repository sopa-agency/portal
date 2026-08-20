import "server-only";
import { prisma } from "@/lib/prisma";
import { currentMonthKey, fetchUsdBrl, toCostDTO, type CostScope, type FixedCostDTO } from "@/lib/fixed-costs";

/**
 * Fetch every project's costs in `slugs`, grouped by slug, with each cost
 * normalized to monthly USD using a single fetched FX rate. Server-only.
 */
export async function fetchCostScope(slugs: string[]): Promise<CostScope> {
  const uniq = [...new Set(slugs)];
  const month = currentMonthKey();
  const [usdBrl, rows] = await Promise.all([
    fetchUsdBrl(),
    prisma.fixedCost
      .findMany({
        where: { projectSlug: { in: uniq } },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
        include: { actuals: true },
      })
      .catch(() => []),
  ]);
  const bySlug: Record<string, FixedCostDTO[]> = {};
  for (const slug of uniq) bySlug[slug] = [];
  for (const r of rows) (bySlug[r.projectSlug] ??= []).push(toCostDTO(r, usdBrl, month));
  return { usdBrl, bySlug };
}
