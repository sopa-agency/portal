import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { reverseEns } from "@/lib/ens";
import type { BoardCard } from "@/app/actions/sopa-boards";

// The org-chart address book: every distinct on-chain address the org tracks
// (revenue-stream receivers across all cards), each with where it's used, its
// resolved/suggested ENS, and whether that ENS was verified. Manual suggestions
// (AddressLabel) win over auto reverse-resolution; unverified names are flagged.

export type AddressBookEntry = {
  address: string; // display (checksum-ish; stored lowercased)
  chains: string[];
  kinds: string[];
  refs: { project: string; label: string }[];
  ens: string | null;
  ensSource: "suggested" | "reverse" | null;
  verified: boolean;
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

export async function getAddressBook(cards: BoardCard[]): Promise<AddressBookEntry[]> {
  // 1. Aggregate unique addresses from tracked revenue streams.
  const map = new Map<
    string,
    { chains: Set<string>; kinds: Set<string>; refs: { project: string; label: string }[] }
  >();
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
  const addresses = [...map.keys()];
  if (!addresses.length) return [];

  // 2. Manual suggestions (win over auto).
  const labels = await prisma.addressLabel
    .findMany({ where: { address: { in: addresses } } })
    .catch(() => []);
  const labelBy = new Map(labels.map((l) => [l.address, l]));

  // 3. Reverse-resolve only the ones without a manual suggestion.
  const needReverse = addresses.filter((a) => !labelBy.has(a));
  const reverse = needReverse.length ? await cachedReverse(needReverse.sort()) : {};

  // 4. Merge.
  const entries: AddressBookEntry[] = addresses.map((addr) => {
    const agg = map.get(addr)!;
    const label = labelBy.get(addr);
    let ens: string | null = null;
    let ensSource: AddressBookEntry["ensSource"] = null;
    let verified = false;
    if (label) {
      ens = label.ens;
      ensSource = "suggested";
      verified = label.verified;
    } else if (reverse[addr]) {
      ens = reverse[addr];
      ensSource = "reverse";
      verified = true; // reverse records are authoritative on mainnet
    }
    return {
      address: addr,
      chains: [...agg.chains].sort(),
      kinds: [...agg.kinds].sort(),
      refs: agg.refs,
      ens,
      ensSource,
      verified,
    };
  });

  // Named first, then by how many places reference it, then address.
  entries.sort(
    (a, b) =>
      Number(!!b.ens) - Number(!!a.ens) || b.refs.length - a.refs.length || a.address.localeCompare(b.address),
  );
  return entries;
}
