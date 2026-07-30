import "server-only";
import { createPublicClient, http, fallback, formatUnits } from "viem";
import { base } from "viem/chains";

// Morpheus "Builders" reward for a builder subnet (Base). A subnet accrues MOR
// emissions over time; `getCurrentSubnetRewards(subnetId)` returns the subnet's
// accrued MOR. We read it, price MOR→USD, and the caller takes SOPA's agreed cut.
//
// Contract: `0x42BB…` is an ERC1967 proxy → **BuildersV4** impl
// (0x18faef315b40a6d9cf49628f1133b1aa507513b0). V4 renamed the getter from
// `getCurrentBuilderReward` (V1) to `getCurrentSubnetRewards` — calling the old
// name reverts. MOR token `0x7431…` (18 dec). The dashboard.mor.org API does NOT
// expose rewards — this on-chain read is the only source. Guarded to 0 on revert.

const BUILDERS = "0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9" as const;
const MOR_BASE = "0x7431aDa8a591C955a994a21710752EF9b882b8e3";

// eth_call works on the plain public RPCs (unlike eth_getLogs); fall through a few.
const RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"];
const client = createPublicClient({ chain: base, transport: fallback(RPCS.map((u) => http(u))) });

const ABI = [
  { type: "function", name: "getCurrentSubnetRewards", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;

export type MorBuilderReward = {
  /** MOR the subnet has accrued so far (0 if the getter reverts / no emissions). */
  morReward: number;
  /** MOR price in USD (0 if the price feed is unavailable). */
  priceUsd: number;
  /** morReward × priceUsd. */
  rewardUsd: number;
};

/** MOR/USD via DefiLlama (on-chain-derived, no key, reachable from Vercel). */
async function fetchMorPriceUsd(): Promise<number> {
  try {
    const key = `base:${MOR_BASE}`;
    const res = await fetch(`https://coins.llama.fi/prices/current/${key}`, {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 3600, tags: ["treasury"] },
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { coins?: Record<string, { price?: number }> };
    const p = json.coins?.[key]?.price;
    return typeof p === "number" && Number.isFinite(p) ? p : 0;
  } catch {
    return 0;
  }
}

/** Read a builder subnet's accrued MOR reward, priced in USD. */
export async function getMorBuilderReward(poolId: string): Promise<MorBuilderReward> {
  const [morReward, priceUsd] = await Promise.all([
    client
      .readContract({ address: BUILDERS, abi: ABI, functionName: "getCurrentSubnetRewards", args: [poolId as `0x${string}`] })
      .then((v) => Number(formatUnits(v as bigint, 18)))
      .catch(() => 0), // guard: reverts if emissions haven't started
    fetchMorPriceUsd(),
  ]);
  return { morReward, priceUsd, rewardUsd: morReward * priceUsd };
}
