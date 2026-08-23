import "server-only";
import { createPublicClient, http, fallback, getAddress, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

// ENS lives on Ethereum mainnet. Keyless public RPCs, fallback across a few so a
// single flaky endpoint doesn't kill resolution. Everything here is best-effort:
// a failure returns null/false, never throws into the caller.
const client = createPublicClient({
  chain: mainnet,
  transport: fallback(
    [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth",
      "https://cloudflare-eth.com",
    ].map((u) => http(u, { timeout: 8000 })),
  ),
});

/** Reverse record: the primary ENS name set for an address, or null. */
export async function reverseEns(address: string): Promise<string | null> {
  if (!isAddress(address)) return null;
  try {
    return await client.getEnsName({ address: getAddress(address) });
  } catch {
    return null;
  }
}

/** Forward-resolve an ENS name (or subname, e.g. `treasury.sopa.eth`) to the
 *  address it points to, or null if it doesn't exist / doesn't resolve. Works
 *  for subENS the same way — viem walks the resolver chain. */
export async function resolveEns(ens: string): Promise<string | null> {
  try {
    return await client.getEnsAddress({ name: normalize(ens) });
  } catch {
    return null;
  }
}

/** Does `ens` forward-resolve to `address`? The integrity check on a suggestion:
 *  a name that doesn't point back to the address is misinformation, not a label. */
export async function ensForwardResolves(ens: string, address: string): Promise<boolean> {
  if (!isAddress(address)) return false;
  const resolved = await resolveEns(ens);
  return !!resolved && resolved.toLowerCase() === address.toLowerCase();
}
