import type { FixedCostDTO } from "@/lib/fixed-costs";
import type { OrgRevenue } from "@/lib/org-revenue";
import type { TreasuryGroup } from "@/lib/treasury";
import { combinedTreasury } from "@/lib/treasury-aggregate";
import { isOk, type Reading } from "@/lib/reading";

type JobLike = {
  amountUsd: number;
  occurredOn: string;
  status: "paid" | "pending";
};

export type FinanceMonthPoint = {
  month: string;
  incomingUsd: number;
  outgoingUsd: number;
  jobsUsd: number;
  onchainIncomingUsd: number;
  fixedCostsUsd: number;
};

export type FinancialDashboardView = {
  slug: string;
  name: string;
  series: FinanceMonthPoint[];
  /** Renamed from `treasuryUsd` on purpose: the rename is what forced every
   *  consumer to face the three states instead of inheriting a number. */
  treasury: Reading<number>;
  burnUsd: number;
  runwayMonths: number | null;
  onchainBalanceUsd: number;
  onchainRealizedTotalUsd: number;
  pendingJobsUsd: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function monthWindow(currentMonth: string, count = 12): string[] {
  const [y, m] = currentMonth.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function emptySeries(months: string[]): FinanceMonthPoint[] {
  return months.map((month) => ({
    month,
    incomingUsd: 0,
    outgoingUsd: 0,
    jobsUsd: 0,
    onchainIncomingUsd: 0,
    fixedCostsUsd: 0,
  }));
}

function addCumulativeSeries(
  series: FinanceMonthPoint[],
  cumulative: { t: string; usd: number }[],
  field: "incomingUsd" | "onchainIncomingUsd",
  monthIndex: Map<string, number>,
) {
  let prev = 0;
  for (const point of cumulative) {
    const delta = Math.max(0, point.usd - prev);
    prev = point.usd;
    if (delta <= 0) continue;
    const month = point.t.slice(0, 7);
    const idx = monthIndex.get(month);
    if (idx == null) continue;
    series[idx][field] += delta;
  }
}

function monthlyCost(cost: FixedCostDTO, month: string): number {
  if (!cost.active) return 0;
  if (!cost.variable) return cost.estimateUsd;
  return cost.actuals.find((actual) => actual.month === month)?.monthlyUsd ?? cost.estimateUsd;
}

export function buildFinancialDashboardViews({
  groups,
  revenue,
  costs,
  jobs,
}: {
  groups: TreasuryGroup[];
  revenue: OrgRevenue | null;
  costs: FixedCostDTO[];
  jobs: JobLike[];
}): FinancialDashboardView[] {
  const currentMonth = costs[0]?.currentMonth ?? new Date().toISOString().slice(0, 7);
  const months = monthWindow(currentMonth, 12);
  const monthIndex = new Map(months.map((month, idx) => [month, idx]));

  // Paid jobs by month + total pending. Jobs are SOPA agency revenue, so they're
  // attributed to the SOPA group (not only the aggregate) — see the map below.
  const paidJobsByMonth = new Map<number, number>();
  let pendingJobsUsd = 0;
  for (const job of jobs) {
    if (job.status === "pending") {
      pendingJobsUsd += job.amountUsd;
      continue;
    }
    const idx = monthIndex.get(job.occurredOn.slice(0, 7));
    if (idx != null) paidJobsByMonth.set(idx, (paidJobsByMonth.get(idx) ?? 0) + job.amountUsd);
  }

  const views = groups.map((group) => {
    const matchedProjects =
      revenue?.projects.filter((project) => {
        const projectKey = norm(project.name);
        return projectKey === norm(group.name) || projectKey === norm(group.slug);
      }) ?? [];
    const groupCosts = costs.filter((cost) => cost.projectSlug === group.slug && cost.active);
    const series = emptySeries(months);

    for (const project of matchedProjects) {
      for (const stream of project.streams) {
        if (stream.realized?.series.length) {
          addCumulativeSeries(series, stream.realized.series, "incomingUsd", monthIndex);
          addCumulativeSeries(series, stream.realized.series, "onchainIncomingUsd", monthIndex);
        } else if (stream.flow?.series.length) {
          addCumulativeSeries(series, stream.flow.series, "incomingUsd", monthIndex);
          addCumulativeSeries(series, stream.flow.series, "onchainIncomingUsd", monthIndex);
        }
      }
    }

    for (const month of months) {
      const idx = monthIndex.get(month);
      if (idx == null) continue;
      const burn = groupCosts.reduce((sum, cost) => sum + monthlyCost(cost, month), 0);
      series[idx].outgoingUsd += burn;
      series[idx].fixedCostsUsd += burn;
    }

    // Jobs are SOPA agency revenue → fold paid jobs into the SOPA group's series.
    const isSopaGroup = norm(group.slug) === "sopa" || norm(group.name) === "sopa";
    if (isSopaGroup) {
      for (const [idx, amt] of paidJobsByMonth) {
        series[idx].incomingUsd += amt;
        series[idx].jobsUsd += amt;
      }
    }

    const treasury = group.report.total;
    const burnUsd = groupCosts.reduce((sum, cost) => sum + cost.monthlyUsd, 0);

    return {
      slug: group.slug,
      name: group.name,
      series,
      treasury,
      burnUsd,
      // Runway is treasury ÷ burn. An unreadable treasury makes it unknowable,
      // and an unknown runway is null — never a number derived from a partial.
      runwayMonths: burnUsd > 0 && isOk(treasury) ? treasury.value / burnUsd : null,
      onchainBalanceUsd: matchedProjects.reduce((sum, project) => sum + project.balanceTotalUsd, 0),
      onchainRealizedTotalUsd: matchedProjects.reduce((sum, project) => sum + project.realizedTotalUsd, 0),
      pendingJobsUsd: isSopaGroup ? pendingJobsUsd : 0,
    };
  });

  const sopaExists = views.some((view) => norm(view.slug) === "sopa" || norm(view.name) === "sopa");
  const allSeries = emptySeries(months);
  for (const view of views) {
    view.series.forEach((point, idx) => {
      allSeries[idx].incomingUsd += point.incomingUsd;
      allSeries[idx].outgoingUsd += point.outgoingUsd;
      allSeries[idx].jobsUsd += point.jobsUsd;
      allSeries[idx].onchainIncomingUsd += point.onchainIncomingUsd;
      allSeries[idx].fixedCostsUsd += point.fixedCostsUsd;
    });
  }
  // No SOPA group present → jobs weren't folded into any view; add them to the
  // aggregate directly so "Tudo" still shows them (no double count when it is).
  if (!sopaExists) {
    for (const [idx, amt] of paidJobsByMonth) {
      allSeries[idx].incomingUsd += amt;
      allSeries[idx].jobsUsd += amt;
    }
  }

  // Native project views may intentionally share a source. The aggregate must
  // count each wallet/account only once (e.g. Hive @gnars in two projects).
  const totalTreasury = combinedTreasury(groups);
  const totalBurnUsd = views.reduce((sum, view) => sum + view.burnUsd, 0);

  return [
    {
      slug: "all",
      name: "Tudo",
      series: allSeries,
      treasury: totalTreasury,
      burnUsd: totalBurnUsd,
      runwayMonths: totalBurnUsd > 0 && isOk(totalTreasury) ? totalTreasury.value / totalBurnUsd : null,
      onchainBalanceUsd: revenue?.balanceTotalUsd ?? 0,
      onchainRealizedTotalUsd: revenue?.realizedTotalUsd ?? 0,
      pendingJobsUsd,
    },
    ...views,
  ];
}
