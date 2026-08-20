"use server";

import { createPublicClient, http, fallback, getAddress, type Address } from "viem";
import { base } from "viem/chains";
import { PIPELINE, TOKENS } from "@/lib/mor-pipeline";

// Compute a protective minOut for a native swapper flash-fill. The swapper prices
// via its UniV3 oracle: amountToBeneficiary = getQuoteAmounts() * scaledOfferFactor
// (a built-in discount = our surplus). The real UniV3 swap output lands a touch
// below the raw oracle quote (pool fee). So minOut = rawQuote * factor keeps the
// bulk of the surplus safe from a sandwich while not reverting on normal
// execution — factors below match the fork-tested margins (A: 2.5% discount /
// 0.3% pool, B: 1% discount / 0.05% pool). Never throws → minOut 0 fallback
// (still principal-safe: the flash reverts if output can't cover the payback).

const HOPS = {
  A: { swapper: PIPELINE.swapperA, oracle: getAddress("0x1B906442dC13716D96f3696771545A31628B8969"), base: TOKENS.mor.address, quote: TOKENS.weth.address, factorBps: BigInt(9850) },
  B: { swapper: PIPELINE.swapperB, oracle: getAddress("0x6B99b2E868B6E3B8b259E296c4c6aBffbB1AaB94"), base: TOKENS.weth.address, quote: TOKENS.usdc.address, factorBps: BigInt(9950) },
} as const;

const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const oracleAbi = [{
  type: "function", name: "getQuoteAmounts", stateMutability: "view",
  inputs: [{
    name: "quoteParams", type: "tuple[]",
    components: [
      { name: "quotePair", type: "tuple", components: [{ name: "base", type: "address" }, { name: "quote", type: "address" }] },
      { name: "baseAmount", type: "uint128" },
      { name: "data", type: "bytes" },
    ],
  }],
  outputs: [{ type: "uint256[]" }],
}] as const;

const client = createPublicClient({
  chain: base,
  transport: fallback(["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].map((u) => http(u))),
});

export type SwapMinOut = { baseAmount: string; minOut: string };

/** Read the swapper's input balance + oracle quote, return the base amount to swap and a protective minOut. */
export async function getSwapMinOut(hop: "A" | "B"): Promise<SwapMinOut> {
  const h = HOPS[hop];
  try {
    const baseAmount = (await client.readContract({ address: h.base as Address, abi: erc20, functionName: "balanceOf", args: [h.swapper] })) as bigint;
    if (baseAmount <= BigInt(1)) return { baseAmount: "0", minOut: "0" };
    const quotes = (await client.readContract({
      address: h.oracle,
      abi: oracleAbi,
      functionName: "getQuoteAmounts",
      args: [[{ quotePair: { base: h.base, quote: h.quote }, baseAmount, data: "0x" }]],
    })) as readonly bigint[];
    const raw = quotes[0] ?? BigInt(0);
    const minOut = (raw * h.factorBps) / BigInt(10000);
    return { baseAmount: baseAmount.toString(), minOut: minOut.toString() };
  } catch {
    // Oracle read failed — fall back to principal-safe minOut 0 (flash still
    // reverts if the swap can't cover the swapper's demanded amount).
    try {
      const baseAmount = (await client.readContract({ address: h.base as Address, abi: erc20, functionName: "balanceOf", args: [h.swapper] })) as bigint;
      return { baseAmount: baseAmount.toString(), minOut: "0" };
    } catch {
      return { baseAmount: "0", minOut: "0" };
    }
  }
}
