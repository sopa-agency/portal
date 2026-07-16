import "server-only";

// Read-side Superfluid (GDA) helpers for the SOPA payroll stream on Base.
// Addresses verified against @superfluid-finance/metadata + on-chain reads.
// Write side (proposing Safe txs) lives elsewhere — this module only READS.

export const SUPERFLUID = {
  chainId: 8453,
  rpc: "https://mainnet.base.org",
  gdaForwarder: "0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08",
  host: "0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74",
  usdcx: "0xD04383398DD2426297da660F9CCA3d439AF9ce1b", // Super USDC, 18 dec
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // native USDC, 6 dec
  subgraph: "https://subgraph-endpoints.superfluid.dev/base-mainnet/protocol-v1",
} as const;

/** The SOPA Safe (pool admin + stream source). */
export const SOPA_SAFE = "0x96C37393B79aD7EABdF9Ccf82C2EDAd3d3c0eEA2";

/**
 * The SOPA payroll distribution pool (GDA). Null until the pool is created
 * once on-chain (admin = SOPA_SAFE) — set it here and the status panel lights up.
 */
export const SOPA_POOL_ADDRESS: string | null = null;

const SECONDS_PER_MONTH = 2_592_000; // 30 days

export type StreamMember = {
  address: string;
  units: number;
  connected: boolean;
  receivedUsd: number; // cumulative, approx (USDCx ≈ USD)
};

export type StreamStatus = {
  poolAddress: string;
  flowRatePerSec: number; // USDCx/sec
  monthlyUsd: number;
  totalUnits: number;
  connectedUnits: number;
  safeUsdcxUsd: number; // Safe's wrapped balance funding the stream
  runwayDays: number | null; // null = infinite (no flow)
  members: StreamMember[];
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUPERFLUID.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    next: { revalidate: 60, tags: ["stream"] },
  });
  const json = (await res.json()) as { result?: T; error?: unknown };
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result as T;
}

/** ERC-20 balanceOf via eth_call (returns raw integer as a JS number of tokens). */
async function balanceOf(token: string, holder: string, decimals: number): Promise<number> {
  const data = `0x70a08231000000000000000000000000${holder.slice(2).toLowerCase()}`;
  const hex = await rpc<string>("eth_call", [{ to: token, data }, "latest"]);
  if (!hex || hex === "0x") return 0;
  return Number(BigInt(hex)) / 10 ** decimals;
}

type SubgraphPool = {
  pool: {
    id: string;
    flowRate: string;
    totalUnits: string;
    totalConnectedUnits: string;
    poolMembers: { units: string; isConnected: boolean; totalAmountReceivedUntilUpdatedAt: string; account: { id: string } }[];
  } | null;
};

/** Auto-discover the SOPA pool by admin = the Safe (so no manual address wiring
 *  once it's created on-chain). Returns the pool address or null. */
export async function findSopaPool(safeAddress = SOPA_SAFE): Promise<string | null> {
  try {
    const query = `query($admin: String!){ pools(where:{admin:$admin}, first:1, orderBy:createdAtTimestamp, orderDirection:desc){ id } }`;
    const res = await fetch(SUPERFLUID.subgraph, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { admin: safeAddress.toLowerCase() } }),
      next: { revalidate: 60, tags: ["stream"] },
    });
    const json = (await res.json()) as { data?: { pools?: { id: string }[] } };
    return json.data?.pools?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function querySubgraph(pool: string): Promise<SubgraphPool["pool"]> {
  const query = `query($pool: ID!) {
    pool(id: $pool) {
      id flowRate totalUnits totalConnectedUnits
      poolMembers(first: 500) {
        units isConnected totalAmountReceivedUntilUpdatedAt
        account { id }
      }
    }
  }`;
  const res = await fetch(SUPERFLUID.subgraph, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { pool: pool.toLowerCase() } }),
    next: { revalidate: 60, tags: ["stream"] },
  });
  const json = (await res.json()) as { data?: SubgraphPool };
  return json.data?.pool ?? null;
}

/**
 * Live state of the SOPA payroll pool: flow rate, monthly USD, per-member units +
 * connection + accrued, the Safe's USDCx balance and the resulting runway.
 * Returns null if no pool is configured or the reads fail (best-effort).
 */
export async function getStreamStatus(poolAddress: string, safeAddress = SOPA_SAFE): Promise<StreamStatus | null> {
  try {
    const [pool, safeUsdcxUsd] = await Promise.all([
      querySubgraph(poolAddress),
      balanceOf(SUPERFLUID.usdcx, safeAddress, 18),
    ]);
    if (!pool) return null;
    const flowRatePerSec = Number(BigInt(pool.flowRate || "0")) / 1e18;
    const monthlyUsd = flowRatePerSec * SECONDS_PER_MONTH;
    const runwayDays = flowRatePerSec > 0 ? safeUsdcxUsd / flowRatePerSec / 86_400 : null;
    const members: StreamMember[] = pool.poolMembers.map((m) => ({
      address: m.account.id,
      units: Number(m.units || "0"),
      connected: m.isConnected,
      receivedUsd: Number(BigInt(m.totalAmountReceivedUntilUpdatedAt || "0")) / 1e18,
    }));
    return {
      poolAddress,
      flowRatePerSec,
      monthlyUsd,
      totalUnits: Number(pool.totalUnits || "0"),
      connectedUnits: Number(pool.totalConnectedUnits || "0"),
      safeUsdcxUsd,
      runwayDays,
      members,
    };
  } catch {
    return null;
  }
}
