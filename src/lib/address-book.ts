import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { reverseEns } from "@/lib/ens";
import { detectEvmDeployments } from "@/lib/evm-presence";
import type { BoardCard } from "@/app/actions/sopa-boards";

// The org-chart address book: every distinct on-chain address the org tracks —
// revenue-stream receivers across all cards, PLUS addresses added by hand — each
// with where it's used, the EVMs its contract is actually deployed on, and its
// resolved/suggested ENS. Manual suggestions win over auto reverse-resolution;
// unverified names are flagged.

export type AddressBookEntry = {
  address: string; // display (stored lowercased)
  chains: string[]; // chains it's registered on (from the streams)
  deployedOn: string[]; // EVMs where contract bytecode was detected
  kinds: string[];
  refs: { project: string; label: string }[];
  ens: string | null;
  ensSource: "suggested" | "reverse" | null;
  verified: boolean;
  manual: boolean; // added by hand, not derived from a stream
  label: string | null; // free-text human label (manual entries)
};

const isAddr = (a: string | null): a is string => !!a && /^0x[a-fA-F0-9]{40}$/.test(a);

// Reverse-resolve a batch of addresses, cached hourly so a page load doesn't
// hammer mainnet. Best-effort: missing names just stay null.
const cachedReverse = unstable_cache(
  async (addrs: string[]): Promise<Record<string, string | null>> => {
    const out: Record<string, string | null> = {};
    await Promise.all(
      addrs.map(async (a) => {
        out[a] = await reverseEns(a);
      }),
    );
    return out;
  },
  ["address-book-reverse-ens"],
  { revalidate: 3600, tags: ["address-book"] },
);

type Agg = { chains: Set<string>; kinds: Set<string>; refs: { project: string; label: string }[] };

export async function getAddressBook(cards: BoardCard[]): Promise<AddressBookEntry[]> {
  // 1. Aggregate unique addresses from tracked revenue streams.
  const map = new Map<string, Agg>();
  for (const card of cards) {
    for (const s of card.revenueStreams) {
      if (s.kind === "manual" || !isAddr(s.address)) continue;
      const key = s.address.toLowerCase();
      const e = map.get(key) ?? { chains: new Set(), kinds: new Set(), refs: [] };
      if (s.chain) e.chains.add(s.chain);
      e.kinds.add(s.kind);
      e.refs.push({ project: card.title, label: s.label });
      map.set(key, e);
    }
  }

  // 2. Load every AddressLabel row (ENS suggestions + manual entries), and fold
  //    manually-added addresses that aren't part of any stream into the set.
  const rows = await prisma.addressLabel.findMany().catch(() => []);
  const labelBy = new Map(rows.map((l) => [l.address, l]));
  for (const l of rows) {
    if (l.manual && isAddr(l.address) && !map.has(l.address)) {
      map.set(l.address, { chains: new Set(), kinds: new Set(["manual"]), refs: [] });
    }
  }

  const addresses = [...map.keys()];
  if (!addresses.length) return [];

  // 3. Reverse-resolve the ones without a manual name suggestion.
  const needReverse = addresses.filter((a) => !labelBy.get(a)?.ens);
  const reverse = needReverse.length ? await cachedReverse(needReverse.sort()) : {};

  // 4. Detect which EVMs each contract-ish address is deployed on (cached 24h).
  const contractish = addresses.filter((a) => {
    const k = map.get(a)!.kinds;
    return k.has("split") || k.has("contract") || k.has("manual");
  });
  const deployed: Record<string, string[]> = {};
  await Promise.all(
    contractish.map(async (a) => {
      deployed[a] = await detectEvmDeployments(a).catch(() => []);
    }),
  );

  // 5. Merge.
  const entries: AddressBookEntry[] = addresses.map((addr) => {
    const agg = map.get(addr)!;
    const l = labelBy.get(addr);
    let ens: string | null = null;
    let ensSource: AddressBookEntry["ensSource"] = null;
    let verified = false;
    if (l?.ens) {
      ens = l.ens;
      ensSource = "suggested";
      verified = l.verified;
    } else if (reverse[addr]) {
      ens = reverse[addr];
      ensSource = "reverse";
      verified = true; // reverse records are authoritative on mainnet
    }
    return {
      address: addr,
      chains: [...agg.chains].sort(),
      deployedOn: deployed[addr] ?? [],
      kinds: [...agg.kinds].sort(),
      refs: agg.refs,
      ens,
      ensSource,
      verified,
      manual: !!l?.manual,
      label: l?.label ?? null,
    };
  });

  // Named first, then by how many places reference it, then address.
  entries.sort(
    (a, b) =>
      Number(!!b.ens) - Number(!!a.ens) || b.refs.length - a.refs.length || a.address.localeCompare(b.address),
  );
  return entries;
}
