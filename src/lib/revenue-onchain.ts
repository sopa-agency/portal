import "server-only";
import { getPrices } from "@/lib/treasury";

// Keyless on-chain revenue history for a tracked address, via Blockscout's public
// v2 API (no API key). Answers "quanto foi pago PELO/AO contrato": inflows
// (received), outflows (paid out to recipients), and a cumulative-received time
// series for the profit chart. Values counted in USDC + ETH/WETH only — memecoin
// dust is ignored (same philosophy as the treasury tracker).

const BLOCKSCOUT_HOST: Record<string, string> = {
  base: "base.blockscout.com",
  ethereum: "eth.blockscout.com",
  optimism: "optimism.blockscout.com",
  arbitrum: "arbitrum.blockscout.com",
};

const MAX_PAGES = 5; // ~250 events/source — bounds cost on busy addresses
const STABLE = new Set(["USDC", "USDBC", "DAI", "USDT"]);
const ETHy = new Set(["WETH", "ETH"]);

export type RevenueFlow = {
  receivedUsd: number;
  paidUsd: number;
  /** Cumulative received (USD) over time — the revenue/profit curve. */
  series: { t: string; usd: number }[];
  truncated: boolean;
  error?: string;
};

type Ev = { t: number; usd: number; dir: 1 | -1 }; // dir +1 = inflow, -1 = outflow

async function bs(host: string, path: string, params: Record<string, string> = {}): Promise<{ items?: unknown[]; next_page_params?: Record<string, string> | null } | null> {
  const url = new URL(`https://${host}/api/v2${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000), next: { revalidate: 300, tags: ["revenue"] } });
    if (!r.ok) return null;
    return (await r.json()) as { items?: unknown[]; next_page_params?: Record<string, string> | null };
  } catch {
    return null;
  }
}

/** Page a Blockscout collection up to MAX_PAGES, returning all items + whether it was cut off. */
async function pageAll(host: string, path: string): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const items: Record<string, unknown>[] = [];
  let next: Record<string, string> | null | undefined = {};
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const res = await bs(host, path, pages === 0 ? {} : next);
    if (!res) break;
    items.push(...((res.items as Record<string, unknown>[]) ?? []));
    next = res.next_page_params;
    pages++;
  }
  return { items, truncated: !!next };
}

const lc = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : (v as { hash?: string })?.hash?.toLowerCase() ?? "");

// --- realized revenue via decoded events (accurate, no refund/spend noise) ----
// AuctionSettled(amount) = a Nouns Builder auction's winning bid (ETH). 0xSplits
// SplitDistributed(token, distributor, amount) = a distribution. Blockscout
// decodes both; we sum the amounts → true gross revenue, with a time series.

const STABLE_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC base
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": 6, // USDbC base
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC ethereum
};
const WETH = new Set([
  "0x4200000000000000000000000000000000000006", // base/op
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // ethereum
]);
const NATIVE = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);

export type RealizedRevenue = {
  method: "auction" | "split" | "none";
  revenueUsd: number;
  count: number;
  series: { t: string; usd: number }[]; // cumulative
  truncated: boolean;
};

type DecodedLog = {
  block_timestamp?: string;
  decoded?: { method_call?: string; parameters?: { name?: string; value?: unknown }[] } | null;
};

const REALIZED_MAX_PAGES = 40; // ~2000 logs — full history for these DAOs

/** Sum realized revenue from a contract's decoded events (AuctionSettled / SplitDistributed). */
export async function fetchOnchainRevenue(address: string, chainKey: string | null): Promise<RealizedRevenue> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { method: "none", revenueUsd: 0, count: 0, series: [], truncated: false };
  const host = BLOCKSCOUT_HOST[chainKey ?? "base"] ?? BLOCKSCOUT_HOST.base;
  // getPrices() now returns null when CoinGecko gives no ETH price. Historical
  // revenue math has no honest answer in that case: valuing ETH events at 0
  // undercounts, and failing the whole read turns a price blip into "revenue 0"
  // at the call sites that catch (sopa-boards.ts). Keeping the previous
  // behaviour on purpose — the fix is a degraded-result flag on
  // RealizedRevenue/RevenueFlow, which is its own change.
  const ethPrice = (await getPrices()).eth ?? 0;

  // Page decoded logs.
  const items: DecodedLog[] = [];
  let next: Record<string, string> | null | undefined = {};
  let pages = 0;
  while (next && pages < REALIZED_MAX_PAGES) {
    const res = await bs(host, `/addresses/${addr}/logs`, pages === 0 ? {} : (next as Record<string, string>));
    if (!res) break;
    items.push(...((res.items as DecodedLog[]) ?? []));
    next = res.next_page_params;
    pages++;
  }
  const truncated = !!next;

  const param = (log: DecodedLog, name: string): string | undefined =>
    log.decoded?.parameters?.find((p) => p.name === name)?.value as string | undefined;

  type Ev = { t: number; usd: number };
  const auctions: Ev[] = [];
  const splits: Ev[] = [];
  for (const log of items) {
    const call = log.decoded?.method_call ?? "";
    const t = Date.parse(log.block_timestamp ?? "") || 0;
    if (call.startsWith("AuctionSettled")) {
      const amt = Number(param(log, "amount") ?? 0) / 1e18;
      if (amt > 0) auctions.push({ t, usd: amt * ethPrice });
    } else if (call.startsWith("SplitDistributed")) {
      const token = (param(log, "token") ?? "").toLowerCase();
      const raw = Number(param(log, "amount") ?? 0);
      let usd = 0;
      if (STABLE_DECIMALS[token]) usd = raw / 10 ** STABLE_DECIMALS[token];
      else if (WETH.has(token) || NATIVE.has(token)) usd = (raw / 1e18) * ethPrice;
      if (usd > 0) splits.push({ t, usd });
    }
  }

  const chosen = auctions.length ? { evs: auctions, method: "auction" as const } : splits.length ? { evs: splits, method: "split" as const } : { evs: [], method: "none" as const };
  chosen.evs.sort((a, b) => a.t - b.t);
  let cum = 0;
  const series: { t: string; usd: number }[] = [];
  for (const e of chosen.evs) {
    cum += e.usd;
    if (e.t) series.push({ t: new Date(e.t).toISOString(), usd: cum });
  }
  return { method: chosen.method, revenueUsd: cum, count: chosen.evs.length, series, truncated };
}

export async function fetchAddressFlows(address: string, chainKey: string | null): Promise<RevenueFlow> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { receivedUsd: 0, paidUsd: 0, series: [], truncated: false, error: "endereço inválido" };
  const host = BLOCKSCOUT_HOST[chainKey ?? "base"] ?? BLOCKSCOUT_HOST.base;
  // getPrices() now returns null when CoinGecko gives no ETH price. Historical
  // revenue math has no honest answer in that case: valuing ETH events at 0
  // undercounts, and failing the whole read turns a price blip into "revenue 0"
  // at the call sites that catch (sopa-boards.ts). Keeping the previous
  // behaviour on purpose — the fix is a degraded-result flag on
  // RealizedRevenue/RevenueFlow, which is its own change.
  const ethPrice = (await getPrices()).eth ?? 0;

  const [erc20, internal, txs] = await Promise.all([
    pageAll(host, `/addresses/${addr}/token-transfers?type=ERC-20`),
    pageAll(host, `/addresses/${addr}/internal-transactions`),
    pageAll(host, `/addresses/${addr}/transactions`),
  ]);
  const truncated = erc20.truncated || internal.truncated || txs.truncated;
  const evs: Ev[] = [];

  // ERC-20 stablecoins + WETH.
  for (const it of erc20.items) {
    const token = it.token as { symbol?: string; decimals?: string } | undefined;
    const sym = (token?.symbol ?? "").toUpperCase();
    const isStable = STABLE.has(sym);
    const isEth = ETHy.has(sym);
    if (!isStable && !isEth) continue;
    const total = it.total as { value?: string; decimals?: string } | undefined;
    const dec = Number(total?.decimals ?? token?.decimals ?? (isStable ? 6 : 18));
    const amt = Number(total?.value ?? 0) / 10 ** dec;
    if (!(amt > 0)) continue;
    const usd = isStable ? amt : amt * ethPrice;
    const to = lc(it.to), from = lc(it.from);
    const t = Date.parse(String(it.timestamp ?? "")) || 0;
    if (to === addr) evs.push({ t, usd, dir: 1 });
    else if (from === addr) evs.push({ t, usd, dir: -1 });
  }

  // Native ETH (internal calls + top-level tx value), no double count: internal
  // = contract-mediated sub-calls; txs.value = top-level sends.
  for (const src of [internal.items, txs.items]) {
    for (const it of src) {
      const v = Number((it as { value?: string }).value ?? 0) / 1e18;
      if (!(v > 0)) continue;
      const usd = v * ethPrice;
      const to = lc(it.to), from = lc(it.from);
      const t = Date.parse(String((it as { timestamp?: string }).timestamp ?? "")) || 0;
      if (to === addr) evs.push({ t, usd, dir: 1 });
      else if (from === addr) evs.push({ t, usd, dir: -1 });
    }
  }

  evs.sort((a, b) => a.t - b.t);
  let receivedUsd = 0;
  let paidUsd = 0;
  const series: { t: string; usd: number }[] = [];
  for (const e of evs) {
    if (e.dir === 1) receivedUsd += e.usd;
    else paidUsd += e.usd;
    if (e.t) series.push({ t: new Date(e.t).toISOString(), usd: receivedUsd });
  }
  return { receivedUsd, paidUsd, series, truncated };
}
