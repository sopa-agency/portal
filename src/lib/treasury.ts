import "server-only";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Treasury data — the SAME sources the native apps use:
// - EVM wallets: the Zapper proxy at api.keepkey.info (what skatehive.app/dao
//   fetches per address; multi-chain token list with USD values).
// - Hive accounts: condenser_api get_accounts + dynamic global props for the
//   VESTS → HP conversion (skatehive.app/dao math), valued via CoinGecko.
// ---------------------------------------------------------------------------

export type EvmToken = {
  symbol: string;
  chain: string;
  balance: number;
  valueUsd: number;
};

export type EvmWalletReport = {
  label: string;
  address: string;
  totalUsd: number;
  tokens: EvmToken[]; // sorted by value desc, dust filtered
  error?: string;
};

export type HiveAccountReport = {
  label: string;
  account: string;
  hive: number;
  hp: number;
  hbd: number;
  hbdSavings: number;
  usd: number;
  error?: string;
};

/**
 * Live Hive yields. `hbdSavings` is authoritative (the chain's hbd_interest_rate
 * — exactly what HBD in savings earns). `hp` is an estimate: the inflation share
 * routed to the vesting fund (≈15%), which passively grows every HP holder's
 * HIVE-per-VESTS — actual yield from curation varies.
 */
export type HiveApr = { hp: number; hbdSavings: number };

export type TreasuryReport = {
  evm: EvmWalletReport[];
  hive: HiveAccountReport[];
  evmTotalUsd: number;
  hiveTotalUsd: number;
  grandTotalUsd: number;
  prices: { hive: number; hbd: number };
  hiveApr: HiveApr | null;
};

// --- prices -----------------------------------------------------------------

export async function getPrices(): Promise<{ hive: number; hbd: number; eth: number }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=hive,hive_dollar,ethereum&vs_currencies=usd",
      { next: { revalidate: 300, tags: ["treasury"] } },
    );
    const data = (await res.json()) as Record<string, { usd?: number }>;
    return {
      hive: data.hive?.usd ?? 0.21,
      hbd: data.hive_dollar?.usd ?? 1.0,
      eth: data.ethereum?.usd ?? 0,
    };
  } catch {
    // Same fallbacks skatehive.app uses when CoinGecko is down.
    return { hive: 0.21, hbd: 1.0, eth: 0 };
  }
}

// --- EVM (live multichain RPC) ------------------------------------------------
// We query the chains directly instead of the Zapper proxy (api.keepkey.info):
// that proxy hard-caches and was serving ~days-stale balances AND a stale ETH
// price (verified by cross-checking 3 independent RPCs + on-chain tx history).
// Native ETH + native USDC across the chains SkateHive actually holds value on
// covers ~all of it; the leftover memecoin dust is negligible. Prices come from
// live CoinGecko (ETH) and $1 for USDC — always current, verifiable on-chain.

type EvmChain = { key: string; rpc: string; usdc: string };
const EVM_CHAINS: EvmChain[] = [
  { key: "ethereum", rpc: "https://ethereum-rpc.publicnode.com", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { key: "base", rpc: "https://mainnet.base.org", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { key: "optimism", rpc: "https://mainnet.optimism.io", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { key: "arbitrum", rpc: "https://arb1.arbitrum.io/rpc", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
];

async function rpcCall<T>(rpc: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(9000),
    next: { revalidate: 300, tags: ["treasury"] },
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.result === undefined) throw new Error(json.error?.message ?? `${method} failed`);
  return json.result;
}

/** Native ETH + native USDC held by `address` on one chain, USD-valued live. */
async function fetchChainBalances(address: string, chain: EvmChain, ethPrice: number): Promise<EvmToken[]> {
  const padded = address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const [ethHex, usdcHex] = await Promise.all([
    rpcCall<string>(chain.rpc, "eth_getBalance", [address, "latest"]),
    rpcCall<string>(chain.rpc, "eth_call", [{ to: chain.usdc, data: `0x70a08231${padded}` }, "latest"]),
  ]);
  const tokens: EvmToken[] = [];
  const eth = parseInt(ethHex, 16) / 1e18;
  if (eth > 0) tokens.push({ symbol: "ETH", chain: chain.key, balance: eth, valueUsd: eth * ethPrice });
  const usdc = parseInt(usdcHex || "0x0", 16) / 1e6;
  if (usdc > 0) tokens.push({ symbol: "USDC", chain: chain.key, balance: usdc, valueUsd: usdc });
  return tokens;
}

async function fetchEvmWallet(label: string, address: string, ethPrice: number): Promise<EvmWalletReport> {
  // Query every chain in parallel; a chain whose RPC errors is skipped (its
  // balances simply don't contribute) rather than failing the whole wallet.
  const perChain = await Promise.all(
    EVM_CHAINS.map((c) =>
      fetchChainBalances(address, c, ethPrice).catch((err) => {
        console.error(`[treasury] ${label} (${address.slice(0, 8)}) ${c.key} RPC failed: ${err instanceof Error ? err.message : String(err)}`);
        return [] as EvmToken[];
      }),
    ),
  );
  const tokens = perChain
    .flat()
    .filter((t) => t.valueUsd >= 0.5) // dust
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
  return { label, address, totalUsd, tokens, error: tokens.length === 0 ? "sem saldos" : undefined };
}

// --- single-address balance (revenue tracking) -------------------------------

/** EVM chains we can track a receiving wallet/contract/split on. */
export const EVM_CHAIN_KEYS = EVM_CHAINS.map((c) => c.key);

export type AddressBalance = { address: string; chain: string | null; totalUsd: number; tokens: EvmToken[]; error?: string };

/**
 * Live native-ETH + USDC balance of any address (wallet, contract, or a 0xSplits
 * split), USD-valued. `chainKey` restricts to one chain; omit for the sum across
 * all supported chains. Reuses the treasury RPC path — same numbers as /treasury.
 */
export async function fetchAddressBalance(address: string, chainKey?: string | null): Promise<AddressBalance> {
  const addr = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return { address, chain: chainKey ?? null, totalUsd: 0, tokens: [], error: "endereço inválido" };
  const chains = chainKey ? EVM_CHAINS.filter((c) => c.key === chainKey) : EVM_CHAINS;
  if (chains.length === 0) return { address: addr, chain: chainKey ?? null, totalUsd: 0, tokens: [], error: "chain desconhecida" };
  const { eth } = await getPrices();
  const perChain = await Promise.all(
    chains.map((c) => fetchChainBalances(addr, c, eth).catch(() => [] as EvmToken[])),
  );
  const tokens = perChain.flat().filter((t) => t.valueUsd >= 0.5).sort((a, b) => b.valueUsd - a.valueUsd);
  return { address: addr, chain: chainKey ?? null, totalUsd: tokens.reduce((s, t) => s + t.valueUsd, 0), tokens };
}

// --- Hive ---------------------------------------------------------------------

async function hiveRpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch("https://api.hive.blog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    next: { revalidate: 300, tags: ["treasury"] },
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.result === undefined) throw new Error(json.error?.message ?? `${method} failed`);
  return json.result;
}

const amount = (v: unknown): number =>
  typeof v === "string" ? parseFloat(v.split(" ")[0]) : parseFloat(String((v as { amount?: string })?.amount ?? "0"));

/** Network inflation rate (%) at a given head block: 9.5% declining 0.01% per
 * 250k blocks, floored at 0.95%. */
function inflationPct(headBlock: number): number {
  return Math.max(0.95, 9.5 - (headBlock / 250000) * 0.01);
}

function computeHiveApr(props: {
  total_vesting_fund_hive: string;
  virtual_supply?: string;
  head_block_number?: number;
  hbd_interest_rate?: number;
}): HiveApr {
  const hbdSavings = (props.hbd_interest_rate ?? 0) / 100; // basis points → %
  const fund = amount(props.total_vesting_fund_hive);
  const supply = amount(props.virtual_supply ?? "0");
  const head = props.head_block_number ?? 0;
  // ≈15% of yearly inflation grows the vesting fund (passive HP yield).
  const VESTING_SHARE = 0.15;
  const hp = fund > 0 && supply > 0 && head > 0
    ? (supply * (inflationPct(head) / 100) * VESTING_SHARE) / fund * 100
    : 0;
  return { hp, hbdSavings };
}

async function fetchHiveAccounts(
  accounts: { label: string; account: string }[],
  prices: { hive: number; hbd: number },
): Promise<{ reports: HiveAccountReport[]; apr: HiveApr | null }> {
  try {
    const [rows, props] = await Promise.all([
      hiveRpc<Array<Record<string, unknown>>>("condenser_api.get_accounts", [accounts.map((a) => a.account)]),
      hiveRpc<{ total_vesting_fund_hive: string; total_vesting_shares: string; virtual_supply: string; head_block_number: number; hbd_interest_rate: number }>(
        "condenser_api.get_dynamic_global_properties",
        [],
      ),
    ]);
    const vestToHive =
      amount(props.total_vesting_fund_hive) / amount(props.total_vesting_shares);

    const reports = accounts.map(({ label, account }) => {
      const row = rows.find((r) => r.name === account);
      if (!row) return { label, account, hive: 0, hp: 0, hbd: 0, hbdSavings: 0, usd: 0, error: "account not found" };
      const hive = amount(row.balance);
      const hp = amount(row.vesting_shares) * vestToHive; // owned HP incl. delegated-out (skatehive.app math)
      const hbd = amount(row.hbd_balance);
      const hbdSavings = amount(row.savings_hbd_balance);
      const usd = (hive + hp) * prices.hive + (hbd + hbdSavings) * prices.hbd;
      return { label, account, hive, hp, hbd, hbdSavings, usd };
    });
    return { reports, apr: computeHiveApr(props) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      reports: accounts.map(({ label, account }) => ({
        label,
        account,
        hive: 0,
        hp: 0,
        hbd: 0,
        hbdSavings: 0,
        usd: 0,
        error,
      })),
      apr: null,
    };
  }
}

// --- entry --------------------------------------------------------------------

export type TreasuryGroup = { slug: string; name: string; report: TreasuryReport };

/**
 * The active project's treasury plus any `includeProjects` treasuries (admin
 * overview, e.g. Reelflip showing Gnars + SkateHive). Groups without a
 * treasury config are skipped.
 */
export async function fetchTreasuryGroups(project: ProjectConfig): Promise<TreasuryGroup[]> {
  const { getProject } = await import("@/projects/index");
  const wanted: ProjectConfig[] = [
    project,
    ...(project.treasury?.includeProjects ?? [])
      .map((slug) => {
        try {
          return getProject(slug);
        } catch {
          return null;
        }
      })
      .filter((p): p is ProjectConfig => !!p && p.slug !== project.slug),
  ];
  const reports = await Promise.all(wanted.map((p) => fetchTreasury(p)));
  return wanted
    .map((p, i) => ({ slug: p.slug, name: p.name, report: reports[i] }))
    .filter((g): g is TreasuryGroup => g.report !== null)
    // Umbrella portals (SOPA) have no wallets of their own — drop the empty
    // group so only real treasuries get tabs.
    .filter((g) => g.report.evm.length > 0 || g.report.hive.length > 0);
}

export async function fetchTreasury(project: ProjectConfig): Promise<TreasuryReport | null> {
  const cfg = project.treasury;
  if (!cfg) return null;

  const prices = await getPrices();
  const [evm, hiveRes] = await Promise.all([
    Promise.all(cfg.ethWallets.map((w) => fetchEvmWallet(w.label, w.address, prices.eth))),
    cfg.hiveAccounts?.length
      ? fetchHiveAccounts(cfg.hiveAccounts, prices)
      : Promise.resolve({ reports: [] as HiveAccountReport[], apr: null as HiveApr | null }),
  ]);
  const hive = hiveRes.reports;

  const evmTotalUsd = evm.reduce((s, w) => s + w.totalUsd, 0);
  const hiveTotalUsd = hive.reduce((s, a) => s + a.usd, 0);
  return { evm, hive, evmTotalUsd, hiveTotalUsd, grandTotalUsd: evmTotalUsd + hiveTotalUsd, prices, hiveApr: hiveRes.apr };
}
