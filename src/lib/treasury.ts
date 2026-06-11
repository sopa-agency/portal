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

export type TreasuryReport = {
  evm: EvmWalletReport[];
  hive: HiveAccountReport[];
  evmTotalUsd: number;
  hiveTotalUsd: number;
  grandTotalUsd: number;
  prices: { hive: number; hbd: number };
};

// --- prices -----------------------------------------------------------------

async function getPrices(): Promise<{ hive: number; hbd: number; eth: number }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=hive,hive_dollar,ethereum&vs_currencies=usd",
      { next: { revalidate: 300 } },
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

// --- Base RPC fallback ----------------------------------------------------------
// The Zapper proxy doesn't index every address (it returned _degraded for the
// Gnars DAO treasury). gnars.com's actual source is Base RPC — same here:
// native ETH + the major stable/wrapped tokens via balanceOf.

const BASE_RPC = "https://mainnet.base.org";
const BASE_TOKENS = [
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, stable: true },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, stable: false },
];

async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    next: { revalidate: 300 },
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.result === undefined) throw new Error(json.error?.message ?? `${method} failed`);
  return json.result;
}

async function fetchBaseRpcWallet(address: string, ethPrice: number): Promise<EvmToken[]> {
  const addrPadded = address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const [ethHex, ...tokenHexes] = await Promise.all([
    baseRpc<string>("eth_getBalance", [address, "latest"]),
    ...BASE_TOKENS.map((t) =>
      baseRpc<string>("eth_call", [{ to: t.address, data: `0x70a08231${addrPadded}` }, "latest"]),
    ),
  ]);
  const tokens: EvmToken[] = [];
  const eth = parseInt(ethHex, 16) / 1e18;
  if (eth > 0) tokens.push({ symbol: "ETH", chain: "base", balance: eth, valueUsd: eth * ethPrice });
  BASE_TOKENS.forEach((t, i) => {
    const bal = parseInt(tokenHexes[i] || "0x0", 16) / 10 ** t.decimals;
    if (bal <= 0) return;
    const valueUsd = t.stable ? bal : bal * ethPrice;
    tokens.push({ symbol: t.symbol, chain: "base", balance: bal, valueUsd });
  });
  return tokens.filter((t) => t.valueUsd >= 0.5).sort((a, b) => b.valueUsd - a.valueUsd);
}

// --- EVM (Zapper proxy) -------------------------------------------------------

async function fetchEvmWallet(label: string, address: string, ethPrice: number): Promise<EvmWalletReport> {
  try {
    const res = await fetch(`https://api.keepkey.info/api/v1/zapper/portfolio/${address}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; MarketingPortal/1.0)" },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`portfolio API HTTP ${res.status}`);
    const data = (await res.json()) as {
      _degraded?: boolean;
      balances?: Array<{ symbol?: string; ticker?: string; chain?: string; balance?: string | number; valueUsd?: string | number }>;
      tokens?: Array<{ symbol?: string; ticker?: string; chain?: string; balance?: string | number; valueUsd?: string | number }>;
    };
    const raw = [...(data.balances ?? []), ...(data.tokens ?? [])];
    let tokens: EvmToken[] = raw
      .map((t) => ({
        symbol: t.symbol || t.ticker || "?",
        chain: t.chain || "ethereum",
        balance: Number(t.balance ?? 0),
        valueUsd: Number(t.valueUsd ?? 0),
      }))
      .filter((t) => t.valueUsd >= 0.5) // dust
      .sort((a, b) => b.valueUsd - a.valueUsd);

    // The proxy doesn't index every address (returns _degraded / empty for the
    // Gnars DAO treasury) — fall back to direct Base RPC, gnars.com's source.
    if (tokens.length === 0 || data._degraded) {
      tokens = await fetchBaseRpcWallet(address, ethPrice);
    }

    const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
    return { label, address, totalUsd, tokens: tokens.slice(0, 8) };
  } catch (err) {
    return {
      label,
      address,
      totalUsd: 0,
      tokens: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- Hive ---------------------------------------------------------------------

async function hiveRpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch("https://api.hive.blog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    next: { revalidate: 300 },
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.result === undefined) throw new Error(json.error?.message ?? `${method} failed`);
  return json.result;
}

const amount = (v: unknown): number =>
  typeof v === "string" ? parseFloat(v.split(" ")[0]) : parseFloat(String((v as { amount?: string })?.amount ?? "0"));

async function fetchHiveAccounts(
  accounts: { label: string; account: string }[],
  prices: { hive: number; hbd: number },
): Promise<HiveAccountReport[]> {
  try {
    const [rows, props] = await Promise.all([
      hiveRpc<Array<Record<string, unknown>>>("condenser_api.get_accounts", [accounts.map((a) => a.account)]),
      hiveRpc<{ total_vesting_fund_hive: string; total_vesting_shares: string }>(
        "condenser_api.get_dynamic_global_properties",
        [],
      ),
    ]);
    const vestToHive =
      amount(props.total_vesting_fund_hive) / amount(props.total_vesting_shares);

    return accounts.map(({ label, account }) => {
      const row = rows.find((r) => r.name === account);
      if (!row) return { label, account, hive: 0, hp: 0, hbd: 0, hbdSavings: 0, usd: 0, error: "account not found" };
      const hive = amount(row.balance);
      const hp = amount(row.vesting_shares) * vestToHive; // owned HP incl. delegated-out (skatehive.app math)
      const hbd = amount(row.hbd_balance);
      const hbdSavings = amount(row.savings_hbd_balance);
      const usd = (hive + hp) * prices.hive + (hbd + hbdSavings) * prices.hbd;
      return { label, account, hive, hp, hbd, hbdSavings, usd };
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return accounts.map(({ label, account }) => ({
      label,
      account,
      hive: 0,
      hp: 0,
      hbd: 0,
      hbdSavings: 0,
      usd: 0,
      error,
    }));
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
    .filter((g): g is TreasuryGroup => g.report !== null);
}

export async function fetchTreasury(project: ProjectConfig): Promise<TreasuryReport | null> {
  const cfg = project.treasury;
  if (!cfg) return null;

  const prices = await getPrices();
  const [evm, hive] = await Promise.all([
    Promise.all(cfg.ethWallets.map((w) => fetchEvmWallet(w.label, w.address, prices.eth))),
    cfg.hiveAccounts?.length ? fetchHiveAccounts(cfg.hiveAccounts, prices) : Promise.resolve([]),
  ]);

  const evmTotalUsd = evm.reduce((s, w) => s + w.totalUsd, 0);
  const hiveTotalUsd = hive.reduce((s, a) => s + a.usd, 0);
  return { evm, hive, evmTotalUsd, hiveTotalUsd, grandTotalUsd: evmTotalUsd + hiveTotalUsd, prices };
}
