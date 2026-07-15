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

export async function fetchAddressFlows(address: string, chainKey: string | null): Promise<RevenueFlow> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { receivedUsd: 0, paidUsd: 0, series: [], truncated: false, error: "endereço inválido" };
  const host = BLOCKSCOUT_HOST[chainKey ?? "base"] ?? BLOCKSCOUT_HOST.base;
  const { eth: ethPrice } = await getPrices();

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
