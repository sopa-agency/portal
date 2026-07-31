import "server-only";

// Shared JSON-RPC helper for Base reads. The public `mainnet.base.org` endpoint
// rate-limits hard (HTTP 429 after ~5 rapid calls, worse from Vercel's shared
// egress IPs), so a single-endpoint reader blanks the UI whenever a page fires a
// burst of eth_calls. We rotate across healthy public providers, falling through
// on any non-OK / JSON-RPC error, and only fall back to base.org last.
//
// The rest of the codebase (community-vaults, vault-depositors) already does this
// via viem's `fallback([...])`; these helpers keep the raw-fetch shape so callers
// preserve Next's fetch cache (revalidate + tags) for cross-render dedupe.
const BASE_RPCS = [
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://base.gateway.tenderly.co",
  "https://mainnet.base.org",
] as const;

type CacheOpts = { revalidate: number; tags: string[] };

/**
 * A JSON-RPC `method` call against Base, trying each provider in turn until one
 * returns a clean result. Throws only if every provider fails (429, 5xx, network
 * error, or a JSON-RPC `error` payload) — so a rate limit on one endpoint no
 * longer surfaces as a missing value.
 */
export async function baseRpc<T>(method: string, params: unknown[], cache: CacheOpts): Promise<T> {
  let lastErr: unknown;
  for (const url of BASE_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        next: { revalidate: cache.revalidate, tags: cache.tags },
      });
      if (!res.ok) {
        lastErr = new Error(`${url} → HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { result?: T; error?: unknown };
      if (json.error) {
        lastErr = new Error(`${url} → ${JSON.stringify(json.error)}`);
        continue;
      }
      return json.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all Base RPCs failed");
}

/** `eth_call` against Base with provider failover; returns the raw hex (or "0x"). */
export async function baseEthCall(to: string, data: string, cache: CacheOpts): Promise<string> {
  const hex = await baseRpc<string>("eth_call", [{ to, data }, "latest"], cache);
  return hex ?? "0x";
}
