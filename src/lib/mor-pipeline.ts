// Not server-only: the treasury page reads status server-side, and the client
// panel re-reads it after each action. All reads are public RPC + public data.
import { createPublicClient, http, fallback, getAddress, formatUnits, type Address } from "viem";
import { base } from "viem/chains";

// The Gnars MOR → USDC pipeline (Base). Claim MOR from the Morpheus Builders
// subnet into a chain of 0xSplits + swappers so the Gnars DAO ends up holding
// USDC and SOPA keeps its share. Every address deployed + verified on Base; the
// full flow has run on mainnet. Owner of the pipeline (and the only account that
// can drive the whole flow) is haxixe.eth. Spec: hackmd Q9ygjv1GRNW5PIHaL_GpXA.
//
// PULL splits: distribute() only CREDITS the SplitsWarehouse; a separate
// withdraw() is required at every hop. The Warehouse (ERC-6909) leaves 1 wei
// behind — treat <= 1 as zero everywhere.

export const PIPELINE = {
  topSplit: getAddress("0x8438326A13CE52e4878De2389dA9bDAadFD2a88a"), // 90% Swapper A / 10% SOPA (MOR)
  swapperA: getAddress("0x4Ca07529d58AD588cB85929688D7a8C0ebe96F24"), // MOR → WETH
  swapperB: getAddress("0x7C76e08ac6b8be41CE38Ad0ad457d48B899b8074"), // WETH → USDC
  downstreamSplit: getAddress("0xcc7E971fB6828e45C01E168849447E460FDF3A4E"), // 80% SOPA / 20% Gnars (USDC)
  warehouse: getAddress("0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8"),
  builders: getAddress("0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9"),
  owner: getAddress("0x8Bf5941d27176242745B716251943Ae4892a3C26"), // haxixe.eth — only driver
  sopa: getAddress("0x96c37393b79ad7eabdf9ccf82c2edad3d3c0eea2"),
  gnarsTreasury: getAddress("0x72ad986ebac0246d2b3c565ab2a1ce3a14ce6f88"),
  subnetId: "0xf129111951997d1c386be9b7de27d4c74490c42ad0ffbcb65e380d17f8a8ea3d" as `0x${string}`,
} as const;

export const TOKENS = {
  mor: { address: getAddress("0x7431aDa8a591C955a994a21710752EF9b882b8e3"), decimals: 18, symbol: "MOR" },
  weth: { address: getAddress("0x4200000000000000000000000000000000000006"), decimals: 18, symbol: "WETH" },
  usdc: { address: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), decimals: 6, symbol: "USDC" },
} as const;

// Split structs — must hash to the stored splitHash() or distribute() reverts.
// Exact verified values (allocations are out of 1_000_000, not percentages).
export const TOP_SPLIT_STRUCT = {
  recipients: [PIPELINE.swapperA, PIPELINE.sopa] as readonly Address[],
  allocations: [BigInt(900000), BigInt(100000)] as readonly bigint[],
  totalAllocation: BigInt(1000000),
  distributionIncentive: 6,
} as const;
export const DOWNSTREAM_SPLIT_STRUCT = {
  recipients: [PIPELINE.sopa, PIPELINE.gnarsTreasury] as readonly Address[],
  allocations: [BigInt(800000), BigInt(200000)] as readonly bigint[],
  totalAllocation: BigInt(1000000),
  distributionIncentive: 6,
} as const;

const splitTuple = { type: "tuple", components: [
  { name: "recipients", type: "address[]" }, { name: "allocations", type: "uint256[]" },
  { name: "totalAllocation", type: "uint256" }, { name: "distributionIncentive", type: "uint16" },
] } as const;

export const pipelineAbis = {
  builders: [{ type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "builderPoolId", type: "bytes32" }, { name: "receiver", type: "address" }], outputs: [] },
    { type: "function", name: "getCurrentSubnetRewards", stateMutability: "view", inputs: [{ name: "subnetId", type: "bytes32" }], outputs: [{ type: "uint256" }] }] as const,
  split: [{ type: "function", name: "distribute", stateMutability: "nonpayable", inputs: [{ name: "_split", ...splitTuple }, { name: "_token", type: "address" }, { name: "_distributor", type: "address" }], outputs: [] }] as const,
  warehouse: [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "_owner", type: "address" }, { name: "_token", type: "address" }], outputs: [] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const,
  erc20: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
} as const;

/** Warehouse (ERC-6909) token id = uint256(uint160(tokenAddress)). */
export const warehouseId = (token: Address) => BigInt(token);

const client = createPublicClient({
  chain: base,
  transport: fallback(["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].map((u) => http(u))),
});

// The Warehouse leaves 1 wei to save gas — treat <= 1 as empty.
const clean = (v: bigint) => (v <= BigInt(1) ? BigInt(0) : v);

export type PipelineStatus = {
  /** Live pending MOR reward in the subnet (not yet claimed). */
  subnetRewardMor: number;
  /** [1] MOR sitting in the top split, awaiting distribute. */
  topSplitMor: number;
  /** [2] Swapper A's Warehouse credit (MOR) — ⚠️ needs withdraw. */
  swapperAWarehouseMor: number;
  /** [3] MOR in Swapper A, ready to swap. */
  swapperAMor: number;
  /** [4] WETH in Swapper B, ready to swap. */
  swapperBWeth: number;
  /** [5] USDC in the downstream split, awaiting distribute. */
  downstreamUsdc: number;
  /** [6] Gnars' Warehouse credit (USDC) — ⚠️ needs withdraw. */
  gnarsWarehouseUsdc: number;
  /** [7] USDC delivered to the Gnars Treasury. */
  gnarsUsdc: number;
  /** SOPA's pending MOR Warehouse credit (its 10% at the top). */
  sopaWarehouseMor: number;
  /** SOPA's pending USDC Warehouse credit (its 80% downstream). */
  sopaWarehouseUsdc: number;
};

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const { mor, weth, usdc } = TOKENS;
  const r = (address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) =>
    client.readContract({ address, abi: abi as never, functionName, args: args as never }) as Promise<bigint>;

  const [reward, topMor, whAMor, aMor, bWeth, downUsdc, whGnarsUsdc, gnarsUsdc, whSopaMor, whSopaUsdc] = await Promise.all([
    r(PIPELINE.builders, pipelineAbis.builders, "getCurrentSubnetRewards", [PIPELINE.subnetId]).catch(() => BigInt(0)),
    r(mor.address, pipelineAbis.erc20, "balanceOf", [PIPELINE.topSplit]),
    r(PIPELINE.warehouse, pipelineAbis.warehouse, "balanceOf", [PIPELINE.swapperA, warehouseId(mor.address)]),
    r(mor.address, pipelineAbis.erc20, "balanceOf", [PIPELINE.swapperA]),
    r(weth.address, pipelineAbis.erc20, "balanceOf", [PIPELINE.swapperB]),
    r(usdc.address, pipelineAbis.erc20, "balanceOf", [PIPELINE.downstreamSplit]),
    r(PIPELINE.warehouse, pipelineAbis.warehouse, "balanceOf", [PIPELINE.gnarsTreasury, warehouseId(usdc.address)]),
    r(usdc.address, pipelineAbis.erc20, "balanceOf", [PIPELINE.gnarsTreasury]),
    r(PIPELINE.warehouse, pipelineAbis.warehouse, "balanceOf", [PIPELINE.sopa, warehouseId(mor.address)]),
    r(PIPELINE.warehouse, pipelineAbis.warehouse, "balanceOf", [PIPELINE.sopa, warehouseId(usdc.address)]),
  ]);

  const n = (v: bigint, d: number) => Number(formatUnits(clean(v), d));
  return {
    subnetRewardMor: n(reward, 18),
    topSplitMor: n(topMor, 18),
    swapperAWarehouseMor: n(whAMor, 18),
    swapperAMor: n(aMor, 18),
    swapperBWeth: n(bWeth, 18),
    downstreamUsdc: n(downUsdc, 6),
    gnarsWarehouseUsdc: n(whGnarsUsdc, 6),
    gnarsUsdc: n(gnarsUsdc, 6),
    sopaWarehouseMor: n(whSopaMor, 18),
    sopaWarehouseUsdc: n(whSopaUsdc, 6),
  };
}
