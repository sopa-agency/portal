import type { TreasuryGroup, TreasuryReport } from "@/lib/treasury";

/**
 * Return a combined-view copy where the same wallet/account is counted once.
 *
 * A source may intentionally appear in more than one project's native view
 * (for example, Hive @gnars is also shown by SkateHive). The first group keeps
 * ownership in the combined view; later groups keep only their unique sources.
 */
export function dedupeTreasuryGroups(groups: TreasuryGroup[]): TreasuryGroup[] {
  const seenEvm = new Set<string>();
  const seenHive = new Set<string>();

  return groups.map((group) => {
    const evm = group.report.evm.filter((wallet) => {
      const key = wallet.address.trim().toLowerCase();
      if (seenEvm.has(key)) return false;
      seenEvm.add(key);
      return true;
    });
    const hive = group.report.hive.filter((account) => {
      const key = account.account.trim().replace(/^@/, "").toLowerCase();
      if (seenHive.has(key)) return false;
      seenHive.add(key);
      return true;
    });
    const evmTotalUsd = evm.reduce((sum, wallet) => sum + wallet.totalUsd, 0);
    const hiveTotalUsd = hive.reduce((sum, account) => sum + account.usd, 0);
    const report: TreasuryReport = {
      ...group.report,
      evm,
      hive,
      evmTotalUsd,
      hiveTotalUsd,
      grandTotalUsd: evmTotalUsd + hiveTotalUsd,
    };
    return { ...group, report };
  });
}

export function combinedTreasuryUsd(groups: TreasuryGroup[]): number {
  return dedupeTreasuryGroups(groups).reduce((sum, group) => sum + group.report.grandTotalUsd, 0);
}
