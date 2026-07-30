import "server-only";
import { keccak256, toHex, decodeAbiParameters } from "viem";

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
//
// Two sources, in order:
//   1. Blockscout's decoded-logs API — fast, pre-decoded, reachable from Vercel.
//   2. Raw `eth_getLogs` over an RPC — used when Blockscout is down (it has real
//      outages) so the treasury share + the org-chart orbit don't go blank with
//      it. Only a few public RPCs serve a full 0→latest, address-filtered range
//      in one call; the rest cap the block range or drop the method.

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

// RPCs proven to serve a full-range, address-filtered `eth_getLogs` in one shot.
// Tried in order; the loop skips any that cap the range or error out.
const LOG_RPCS: Record<string, string[]> = {
  base: ["https://base.gateway.tenderly.co", "https://gateway.tenderly.co/public/base"],
};

// keccak256("SplitUpdated((address[],uint256[],uint256,uint16))")
const SPLIT_UPDATED_TOPIC = keccak256(toHex("SplitUpdated((address[],uint256[],uint256,uint16))"));
const SPLIT_TUPLE = [
  {
    type: "tuple",
    components: [{ type: "address[]" }, { type: "uint256[]" }, { type: "uint256" }, { type: "uint16" }],
  },
] as const;

type DecodedParam = { name: string; value: unknown };
type LogItem = { decoded?: { method_call?: string; parameters?: DecodedParam[] } | null };

/** Build a SplitConfig from raw recipients/allocations, or null if inconsistent. */
function toSplitConfig(address: string, addrs: unknown[], allocs: unknown[], totalRaw: unknown): SplitConfig | null {
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
}

/** Source 1 — Blockscout's decoded logs (newest-first). */
async function readViaBlockscout(host: string, address: string): Promise<SplitConfig | null> {
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
  return toSplitConfig(address, addrs, allocs, totalRaw);
}

/** Source 2 — raw `eth_getLogs`, decoded here (oldest-first, so take the last). */
async function readViaRpc(chain: string, address: string): Promise<SplitConfig | null> {
  const rpcs = LOG_RPCS[chain] ?? [];
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(9000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getLogs",
          params: [{ address, topics: [SPLIT_UPDATED_TOPIC], fromBlock: "0x0", toBlock: "latest" }],
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: Array<{ data: `0x${string}` }> };
      const logs = json.result;
      if (!Array.isArray(logs) || logs.length === 0) continue; // capped range / no event → next rpc

      // eth_getLogs returns ascending block order; the last is the live config.
      const [cfg] = decodeAbiParameters(SPLIT_TUPLE, logs[logs.length - 1].data);
      const [addrs, allocs, totalRaw] = cfg as unknown as [readonly string[], readonly bigint[], bigint];
      return toSplitConfig(address, [...addrs], [...allocs], totalRaw);
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

/**
 * Read a split's recipients + allocations. Returns null when the address isn't a
 * readable v2 split (unverified proxy, wrong chain, no event) — callers must
 * treat that as "unknown", never as a default share.
 */
export async function getSplitConfig(address: string, chain: string | null): Promise<SplitConfig | null> {
  const key = chain ?? "base";
  const host = BLOCKSCOUT[key];
  if (host) {
    try {
      const viaExplorer = await readViaBlockscout(host, address);
      if (viaExplorer) return viaExplorer;
    } catch {
      // fall through to the RPC source
    }
  }
  return readViaRpc(key, address);
}
