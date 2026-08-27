import { evmWalletReading, hiveAccountReading, type TreasuryGroup, type TreasuryReport } from "@/lib/treasury";
import { readHealth, sumReadings, type Reading } from "@/lib/reading";

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
    // Deduping drops wallets, so the totals have to be recomputed — and they
    // are recomputed as READINGS, over the surviving leaves. Re-summing the
    // numbers here was the second place a failed wallet counted as zero.
    const evmReadings = evm.map(evmWalletReading);
    const hiveReadings = hive.map(hiveAccountReading);
    const all = [...evmReadings, ...hiveReadings];
    const report: TreasuryReport = {
      ...group.report,
      evm,
      hive,
      evmTotal: sumReadings(evmReadings),
      hiveTotal: sumReadings(hiveReadings),
      total: sumReadings(all),
      health: readHealth(all),
      unreadLabels: [
        ...evm.filter((w) => w.failedChains.length > 0).map((w) => w.label),
        ...hive.filter((a) => a.error).map((a) => a.label),
      ],
    };
    return { ...group, report };
  });
}

/**
 * The combined treasury across groups — as a reading.
 *
 * One group being unable to read makes the COMBINED figure incomplete, which
 * is exactly the case `sumReadings` exists to refuse. Callers that used to get
 * a number now have to say what they show when it isn't one.
 */
export function combinedTreasury(groups: TreasuryGroup[]): Reading<number> {
  return sumReadings(dedupeTreasuryGroups(groups).map((group) => group.report.total));
}
