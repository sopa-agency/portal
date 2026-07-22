import "server-only";
import { createPublicClient, http, fallback, formatUnits, getAddress } from "viem";
import { base } from "viem/chains";
import { prisma } from "@/lib/prisma";

// Who is backing the community vault, and with how much.
//
// Holders are discovered from the vault's Deposit events (Blockscout — the
// public RPC caps eth_getLogs), then each holder's CURRENT position is valued
// as convertToAssets(balanceOf). Events tell us *who*; only the live call tells
// us *how much*, since shares appreciate and people withdraw. (maxWithdraw reads
// 0 here — the liquidity is parked in the Moonwell adapter, not idle.)

export type VaultDepositor = {
  address: string;
  /** Portal member name when the wallet is a known payroll member. */
  label: string | null;
  /** Redeemable USDC right now (principal + accrued yield). */
  assets: number;
  /** Share of the vault, 0–1. */
  share: number;
  /** True for the burn address that holds the anti-inflation dead deposit. */
  isDeadDeposit: boolean;
};

const DEAD = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

// A holder's position = value of the shares they hold. NOT maxWithdraw: on a
// Vault V2 whose liquidity sits in an adapter, maxWithdraw returns 0 (it only
// counts idle liquidity), which would drop every real depositor from the list.
// convertToAssets(balanceOf) is the true redeemable value.
const POSITION_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

type Log = {
  decoded?: { method_call?: string; parameters?: { name: string; value: unknown }[] } | null;
};

async function fetchDepositorAddresses(vault: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    let next: Record<string, string> | null | undefined = {};
    let pages = 0;
    while (next && pages < 10) {
      const qs = new URLSearchParams(pages === 0 ? {} : next).toString();
      const res = await fetch(`https://base.blockscout.com/api/v2/addresses/${vault}/logs${qs ? `?${qs}` : ""}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(9000),
        next: { revalidate: 300, tags: ["treasury"] },
      });
      if (!res.ok) break;
      const json = (await res.json()) as { items?: Log[]; next_page_params?: Record<string, string> | null };
      for (const log of json.items ?? []) {
        if (!(log.decoded?.method_call ?? "").startsWith("Deposit")) continue;
        // ERC-4626 Deposit(sender, owner, assets, shares) — `owner` holds the shares.
        const params = log.decoded?.parameters ?? [];
        const owner = params.find((p) => p.name === "owner")?.value ?? params.find((p) => p.name === "receiver")?.value;
        if (typeof owner === "string" && /^0x[a-fA-F0-9]{40}$/.test(owner)) out.add(owner.toLowerCase());
      }
      next = json.next_page_params;
      pages++;
    }
  } catch {
    /* fall through — an empty list reads as "no backers yet", never a wrong number */
  }
  return [...out];
}

export async function getVaultDepositors(vault: string): Promise<VaultDepositor[]> {
  const addresses = await fetchDepositorAddresses(vault.toLowerCase());
  if (addresses.length === 0) return [];

  // Single-RPC reads rate-limit from Vercel's datacenter IPs — every position
  // read would fail and drop the depositor, blanking the panel. Fall through a few.
  const client = createPublicClient({
    chain: base,
    transport: fallback(
      ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"].map((u) => http(u)),
    ),
  });
  const members = await prisma.payrollMember
    .findMany({ select: { label: true, address: true } })
    .catch(() => [] as { label: string; address: string }[]);
  const nameByAddress = new Map(members.map((m) => [m.address.toLowerCase(), m.label]));

  const rows: VaultDepositor[] = [];
  for (const address of addresses) {
    let assets = 0;
    try {
      const shares = await client.readContract({
        address: getAddress(vault),
        abi: POSITION_ABI,
        functionName: "balanceOf",
        args: [getAddress(address)],
      });
      if (shares > BigInt(0)) {
        const raw = await client.readContract({
          address: getAddress(vault),
          abi: POSITION_ABI,
          functionName: "convertToAssets",
          args: [shares],
        });
        assets = Number(formatUnits(raw, 6));
      }
    } catch {
      continue; // skip rather than report a zero we didn't actually read
    }
    if (assets <= 0) continue; // fully withdrawn — no longer a backer
    rows.push({
      address,
      label: nameByAddress.get(address) ?? null,
      assets,
      share: 0,
      isDeadDeposit: DEAD.has(address),
    });
  }

  const total = rows.reduce((s, r) => s + r.assets, 0);
  for (const r of rows) r.share = total > 0 ? r.assets / total : 0;
  return rows.sort((a, b) => b.assets - a.assets);
}
