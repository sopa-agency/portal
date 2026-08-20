"use server";

import { getSplitClaim, type SplitClaim } from "@/lib/split-claim";

/**
 * What's currently collectable for a revenue split (distributable token balances
 * + recipient Warehouse credits). Client-callable so the collect button can read
 * it on demand and re-read after running the txs. Returns null for a non-split.
 */
export async function fetchSplitClaim(address: string, chain: string | null): Promise<SplitClaim | null> {
  return getSplitClaim(address, chain).catch(() => null);
}
