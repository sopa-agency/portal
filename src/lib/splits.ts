import "server-only";

// 0xSplits v2 (PullSplit) config, read from the chain instead of assumed.
//
// The portal used to hardcode "SOPA gets 50% of every swap split". That happened
// to be true, but a hardcoded share is a claim the UI can't back up: if anyone
// re-splits a contract, the treasury quietly reports the wrong number forever.
//
// PullSplit stores only a HASH of its config on-chain, so the recipients and
// allocations can't be read with a plain `eth_call` — they live in the
// `SplitUpdated((address[],uint256[],uint256,uint16))` event. We read the most
// recent one per split.

export type SplitRecipient = {
  address: string;
  /** Fraction of the split, 0–1. */
  share: number;
};

export type SplitConfig = {
  address: string;
  recipients: SplitRecipient[];
  /** Share going to `owner`, 0–1. Null when the address isn't a recipient. */
  shareFor: (owner: string) => number | null;
};

const BLOCKSCOUT: Record<string, string> = {
  base: "https://base.blockscout.com",
};

type DecodedParam = { name: string; value: unknown };
type LogItem = { decoded?: { method_call?: string; parameters?: DecodedParam[] } | null };

/**
 * Read a split's recipients + allocations. Returns null when the address isn't a
 * readable v2 split (unverified proxy, wrong chain, no event) — callers must
 * treat that as "unknown", never as a default share.
 */
export async function getSplitConfig(address: string, chain: string | null): Promise<SplitConfig | null> {
  const host = BLOCKSCOUT[chain ?? "base"];
  if (!host) return null;
  try {
    const res = await fetch(`${host}/api/v2/addresses/${address}/logs`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
      next: { revalidate: 3600, tags: ["treasury"] },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: LogItem[] };

    // Logs come newest-first, so the first SplitUpdated is the live config.
    const updated = (json.items ?? []).find((l) => (l.decoded?.method_call ?? "").startsWith("SplitUpdated"));
    const tuple = updated?.decoded?.parameters?.[0]?.value;
    if (!Array.isArray(tuple)) return null;

    const [addrs, allocs, totalRaw] = tuple as [unknown, unknown, unknown];
    if (!Array.isArray(addrs) || !Array.isArray(allocs)) return null;
    const total = Number(totalRaw);
    if (!Number.isFinite(total) || total <= 0) return null;

    const recipients: SplitRecipient[] = addrs.map((a, i) => ({
      address: String(a),
      share: Number(allocs[i] ?? 0) / total,
    }));
    if (recipients.some((r) => !Number.isFinite(r.share))) return null;

    return {
      address,
      recipients,
      shareFor: (owner) => {
        const hit = recipients.find((r) => r.address.toLowerCase() === owner.toLowerCase());
        return hit ? hit.share : null;
      },
    };
  } catch {
    return null;
  }
}
