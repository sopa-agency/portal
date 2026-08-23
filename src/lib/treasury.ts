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
  /** USD value, or null when we have the balance but NO trustworthy price
   *  (rule 5: unknown is not zero — show the quantity, mark USD unavailable).
   *  A failed READ never lands here; it surfaces as a failed chain instead. */
  valueUsd: number | null;
  /** Optional UI note (e.g. "GDA pool claimable not included"). */
  note?: string;
};

export type EvmWalletReport = {
  label: string;
  address: string;
  totalUsd: number;
  tokens: EvmToken[]; // sorted by value desc, dust filtered
  /** Chains whose on-chain read FAILED — their balances are unknown, NOT zero.
   *  The UI must show these as "read failed", never let them count as 0. */
  failedChains: string[];
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

// ERC-4626 vaults the treasury parks USDC in. Without these, staking looks like
// the money left the treasury: the balance drops and the total is simply wrong.
// `maxWithdraw(owner)` gives the redeemable USDC (principal + accrued yield).
type Erc4626Vault = { address: string; symbol: string; decimals: number };

/** Extra known ERC-20s to also read for a SPECIFIC wallet (config-driven, e.g.
 *  the SOPA Safe's USDCx + $gnars). `usd: "one"` prices 1:1 (Super USDC);
 *  `usd: "none"` = balance known but NO trustworthy price → rule 5 (show the
 *  quantity, USD unavailable). A token name here is trusted config, not indexed
 *  spam — enumerating ALL tokens (which would leak scam tokens) is out of scope. */
export type ExtraToken = { chain: string; address: string; symbol: string; decimals: number; usd: "one" | "none"; note?: string };

type EvmChain = { key: string; rpcs: string[]; usdc: string; vaults?: Erc4626Vault[] };
// Each chain lists MULTIPLE RPCs, tried in order — a single flaky public endpoint
// (mainnet.base.org rate-limits Vercel datacenter IPs) must not silently zero a
// balance. All fail ⇒ the chain reports a FAILED read, never 0.
const EVM_CHAINS: EvmChain[] = [
  { key: "ethereum", rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth", "https://cloudflare-eth.com"], usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  {
    key: "base",
    rpcs: ["https://base.gateway.tenderly.co", "https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"],
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    // Moonwell Flagship USDC (MetaMorpho) — where the SOPA Safe stakes.
    vaults: [{ address: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca", symbol: "USDC (staked)", decimals: 6 }],
  },
  { key: "optimism", rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://optimism.drpc.org"], usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { key: "arbitrum", rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"], usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
];

// Try each RPC in order; return on the first success. Throw only if ALL fail —
// and that throw becomes a "failed chain" upstream, never a silent 0.
async function rpcCall<T>(rpcs: string[], method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = new Error("no RPCs");
  for (const rpc of rpcs) {
    try {
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
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** A chain's balances, OR an explicit read failure. The union is the point: a
 *  caller CANNOT accidentally treat a failed read as an empty wallet. */
export type ChainRead = { ok: true; tokens: EvmToken[] } | { ok: false; chain: string; error: string };

/** Native ETH + native USDC + staked USDC (+ configured extra tokens) held by
 *  `address` on one chain. A read failure returns ok:false — surfaced as a failed
 *  chain, NEVER counted as zero. */
async function fetchChainBalances(address: string, chain: EvmChain, ethPrice: number, extra: ExtraToken[] = []): Promise<ChainRead> {
  const padded = address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const balOf = (to: string) => rpcCall<string>(chain.rpcs, "eth_call", [{ to, data: `0x70a08231${padded}` }, "latest"]);
  const chainExtra = extra.filter((e) => e.chain === chain.key);
  try {
    const [ethHex, usdcHex, vaultHexes, extraHexes] = await Promise.all([
      rpcCall<string>(chain.rpcs, "eth_getBalance", [address, "latest"]),
      balOf(chain.usdc),
      // 0xce96cb77 = maxWithdraw(address): redeemable USDC (principal + yield).
      Promise.all((chain.vaults ?? []).map((v) => rpcCall<string>(chain.rpcs, "eth_call", [{ to: v.address, data: `0xce96cb77${padded}` }, "latest"]))),
      Promise.all(chainExtra.map((e) => balOf(e.address))),
    ]);
    const tokens: EvmToken[] = [];
    const eth = parseInt(ethHex, 16) / 1e18;
    if (eth > 0) tokens.push({ symbol: "ETH", chain: chain.key, balance: eth, valueUsd: eth * ethPrice });
    const usdc = parseInt(usdcHex || "0x0", 16) / 1e6;
    if (usdc > 0) tokens.push({ symbol: "USDC", chain: chain.key, balance: usdc, valueUsd: usdc });
    (chain.vaults ?? []).forEach((v, i) => {
      const assets = parseInt(vaultHexes[i] || "0x0", 16) / 10 ** v.decimals;
      if (assets > 0) tokens.push({ symbol: v.symbol, chain: chain.key, balance: assets, valueUsd: assets });
    });
    chainExtra.forEach((e, i) => {
      const b = parseInt(extraHexes[i] || "0x0", 16) / 10 ** e.decimals;
      if (b > 0) tokens.push({ symbol: e.symbol, chain: chain.key, balance: b, valueUsd: e.usd === "one" ? b : null, note: e.note });
    });
    return { ok: true, tokens };
  } catch (e) {
    return { ok: false, chain: chain.key, error: e instanceof Error ? e.message : String(e) };
  }
}

// Dust filter that PRESERVES unknown-USD tokens: a token with a known USD value
// must clear $0.50; a token with an unknown price (valueUsd null, rule 5) is kept
// whenever it has a positive balance — dropping it would hide real holdings.
const keepAndSort = (tokens: EvmToken[]): EvmToken[] =>
  tokens
    .filter((t) => (t.valueUsd == null ? t.balance > 0 : t.valueUsd >= 0.5))
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

async function fetchEvmWallet(
  wallet: { label: string; address: string; extraTokens?: ExtraToken[] },
  ethPrice: number,
): Promise<EvmWalletReport> {
  // Query every chain in parallel. A chain whose read FAILS is recorded in
  // failedChains (its balances are UNKNOWN, not zero) — never silently dropped.
  const reads = await Promise.all(
    EVM_CHAINS.map((c) => fetchChainBalances(wallet.address, c, ethPrice, wallet.extraTokens ?? [])),
  );
  const all: EvmToken[] = [];
  const failedChains: string[] = [];
  for (const r of reads) {
    if (r.ok) all.push(...r.tokens);
    else {
      failedChains.push(r.chain);
      console.error(`[treasury] ${wallet.label} (${wallet.address.slice(0, 8)}) ${r.chain} read failed: ${r.error}`);
    }
  }
  const tokens = keepAndSort(all);
  const totalUsd = tokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);
  const error = failedChains.length
    ? `leitura falhou: ${failedChains.join(", ")}`
    : tokens.length === 0
      ? "sem saldos"
      : undefined;
  return { label: wallet.label, address: wallet.address, totalUsd, tokens, failedChains, error };
}

// --- single-address balance (revenue tracking) -------------------------------

/** EVM chains we can track a receiving wallet/contract/split on. */
export const EVM_CHAIN_KEYS = EVM_CHAINS.map((c) => c.key);

export type AddressBalance = { address: string; chain: string | null; totalUsd: number; tokens: EvmToken[]; failedChains: string[]; error?: string };

/**
 * Live native-ETH + USDC balance of any address (wallet, contract, or a 0xSplits
 * split), USD-valued. `chainKey` restricts to one chain; omit for the sum across
 * all supported chains. Reuses the treasury RPC path — same numbers as /treasury.
 */
export async function fetchAddressBalance(address: string, chainKey?: string | null): Promise<AddressBalance> {
  const addr = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return { address, chain: chainKey ?? null, totalUsd: 0, tokens: [], failedChains: [], error: "endereço inválido" };
  const chains = chainKey ? EVM_CHAINS.filter((c) => c.key === chainKey) : EVM_CHAINS;
  if (chains.length === 0) return { address: addr, chain: chainKey ?? null, totalUsd: 0, tokens: [], failedChains: [], error: "chain desconhecida" };
  const { eth } = await getPrices();
  const reads = await Promise.all(chains.map((c) => fetchChainBalances(addr, c, eth)));
  const all: EvmToken[] = [];
  const failedChains: string[] = [];
  for (const r of reads) {
    if (r.ok) all.push(...r.tokens);
    else failedChains.push(r.chain);
  }
  const tokens = keepAndSort(all);
  return {
    address: addr,
    chain: chainKey ?? null,
    totalUsd: tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
    tokens,
    failedChains,
    error: failedChains.length ? `leitura falhou: ${failedChains.join(", ")}` : undefined,
  };
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
    Promise.all(cfg.ethWallets.map((w) => fetchEvmWallet(w, prices.eth))),
    cfg.hiveAccounts?.length
      ? fetchHiveAccounts(cfg.hiveAccounts, prices)
      : Promise.resolve({ reports: [] as HiveAccountReport[], apr: null as HiveApr | null }),
  ]);
  const hive = hiveRes.reports;

  const evmTotalUsd = evm.reduce((s, w) => s + w.totalUsd, 0);
  const hiveTotalUsd = hive.reduce((s, a) => s + a.usd, 0);
  return { evm, hive, evmTotalUsd, hiveTotalUsd, grandTotalUsd: evmTotalUsd + hiveTotalUsd, prices, hiveApr: hiveRes.apr };
}
