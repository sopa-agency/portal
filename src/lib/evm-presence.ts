import "server-only";
import { unstable_cache } from "next/cache";

// Which of the main EVMs a contract is actually deployed on. 0xSplits (and lots
// of factory-deployed contracts) land at the SAME address on many chains via
// CREATE2 — so an address in the book can be a live split on Base, Ethereum AND
// Arbitrum at once. We probe each chain with eth_getCode: bytecode present ⇒ the
// contract exists there. Keyless public RPCs; best-effort per chain.

export const MAIN_EVMS: { key: string; label: string; chainId: number; rpc: string }[] = [
  { key: "ethereum", label: "Ethereum", chainId: 1, rpc: "https://ethereum-rpc.publicnode.com" },
  { key: "base", label: "Base", chainId: 8453, rpc: "https://base-rpc.publicnode.com" },
  { key: "optimism", label: "Optimism", chainId: 10, rpc: "https://optimism-rpc.publicnode.com" },
  { key: "arbitrum", label: "Arbitrum", chainId: 42161, rpc: "https://arbitrum-one-rpc.publicnode.com" },
  { key: "polygon", label: "Polygon", chainId: 137, rpc: "https://polygon-bor-rpc.publicnode.com" },
  { key: "bsc", label: "BNB Chain", chainId: 56, rpc: "https://bsc-rpc.publicnode.com" },
  { key: "avalanche", label: "Avalanche", chainId: 43114, rpc: "https://avalanche-c-chain-rpc.publicnode.com" },
  { key: "gnosis", label: "Gnosis", chainId: 100, rpc: "https://gnosis-rpc.publicnode.com" },
];

async function hasCode(rpc: string, address: string): Promise<boolean> {
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
      signal: AbortSignal.timeout(6000),
    });
    const j = (await r.json()) as { result?: string };
    return typeof j.result === "string" && j.result.length > 2; // "0x" = no code
  } catch {
    return false;
  }
}

/** The EVM keys (from MAIN_EVMS) where this address has contract bytecode.
 *  Cached 24h — a contract's presence doesn't change. */
export const detectEvmDeployments = unstable_cache(
  async (address: string): Promise<string[]> => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return [];
    const hits = await Promise.all(
      MAIN_EVMS.map(async (c) => ({ key: c.key, has: await hasCode(c.rpc, address) })),
    );
    return hits.filter((h) => h.has).map((h) => h.key);
  },
  ["evm-presence"],
  { revalidate: 86400, tags: ["address-book"] },
);
