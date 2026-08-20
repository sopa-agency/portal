import "server-only";
import { createPublicClient, http, fallback, getAddress, formatUnits, type Address } from "viem";
import { base } from "viem/chains";
import { getSplitDistributeConfig, type SplitDistributeConfig } from "@/lib/splits";

// "Collect" a 0xSplits revenue split into the treasury without leaving the app.
// A split accrues fee revenue (USDC/WETH/MOR/…) but the money only reaches the
// recipients once someone calls `distribute()` — and, for a PullSplit, once each
// recipient `withdraw()`s their Warehouse credit. Both calls are permissionless
// (funds can only go to the split's fixed recipients), so any wallet can trigger
// them. This reads what's currently collectable so the UI can show + run it.
//
// Base only — the splits reader (SplitUpdated via Blockscout/RPC) is Base-scoped.

const WAREHOUSE = getAddress("0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8");

// The revenue tokens we sweep — mirror of the treasury/revenue token set.
export const CLAIM_TOKENS = [
  { address: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), symbol: "USDC", decimals: 6 },
  { address: getAddress("0xd9aaEC86B65D86f6A7B5B1b0c42FFA531710b6CA"), symbol: "USDbC", decimals: 6 },
  { address: getAddress("0x4200000000000000000000000000000000000006"), symbol: "WETH", decimals: 18 },
  { address: getAddress("0x7431aDa8a591C955a994a21710752EF9b882b8e3"), symbol: "MOR", decimals: 18 },
] as const;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const warehouseAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

/** Warehouse (ERC-6909) token id = uint256(uint160(tokenAddress)). */
const warehouseId = (token: Address) => BigInt(token);
// The Warehouse leaves 1 wei behind to save gas — treat <= 1 as empty.
const clean = (v: bigint) => (v <= BigInt(1) ? BigInt(0) : v);

const client = createPublicClient({
  chain: base,
  transport: fallback(
    ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].map((u) => http(u)),
  ),
});

export type ClaimToken = { address: string; symbol: string; decimals: number; amount: string; amountUi: number };
export type ClaimWithdraw = ClaimToken & { recipient: string };

export type SplitClaim = {
  config: SplitDistributeConfig;
  warehouse: string;
  /** Tokens sitting in the split, ready to `distribute()`. */
  distributable: ClaimToken[];
  /** Recipient Warehouse credits, ready to `withdraw()`. */
  withdrawable: ClaimWithdraw[];
};

/**
 * Read what's collectable for a split: token balances sitting in the split
 * (distributable) + recipient Warehouse credits (withdrawable). Returns null
 * when the address isn't a readable Base split. Never throws.
 */
export async function getSplitClaim(address: string, chain: string | null): Promise<SplitClaim | null> {
  if ((chain ?? "base") !== "base") return null;
  const config = await getSplitDistributeConfig(address, chain).catch(() => null);
  if (!config) return null;

  const split = getAddress(address);
  const read = (a: Address, abi: readonly unknown[], fn: string, args: readonly unknown[]) =>
    client.readContract({ address: a, abi: abi as never, functionName: fn, args: args as never }).catch(() => BigInt(0)) as Promise<bigint>;

  // Split's own token balances → distributable.
  const splitBals = await Promise.all(CLAIM_TOKENS.map((t) => read(t.address, erc20Abi, "balanceOf", [split])));
  const distributable: ClaimToken[] = [];
  CLAIM_TOKENS.forEach((t, i) => {
    const amt = clean(splitBals[i]);
    if (amt > BigInt(0)) distributable.push({ address: t.address, symbol: t.symbol, decimals: t.decimals, amount: amt.toString(), amountUi: Number(formatUnits(amt, t.decimals)) });
  });

  // Recipient Warehouse credits → withdrawable.
  const recips = config.recipients.map((r) => getAddress(r));
  const whReads = recips.flatMap((r) => CLAIM_TOKENS.map((t) => ({ r, t })));
  const whBals = await Promise.all(whReads.map(({ r, t }) => read(WAREHOUSE, warehouseAbi, "balanceOf", [r, warehouseId(t.address)])));
  const withdrawable: ClaimWithdraw[] = [];
  whReads.forEach(({ r, t }, i) => {
    const amt = clean(whBals[i]);
    if (amt > BigInt(0)) withdrawable.push({ recipient: r, address: t.address, symbol: t.symbol, decimals: t.decimals, amount: amt.toString(), amountUi: Number(formatUnits(amt, t.decimals)) });
  });

  return { config, warehouse: WAREHOUSE, distributable, withdrawable };
}
