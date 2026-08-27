import "server-only";
import { zerionBalances } from "@/lib/zerion";
import { ok, readHealth, sumReadings, unread, type Reading } from "@/lib/reading";
import type { ProjectConfig } from "@/projects/types";
import { sanitizeTokenLabel, labelLooksHostile, SYMBOL_MAX, NAME_MAX } from "@/lib/token-label";

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
  /** TRUE when the symbol/name came from an indexer instead of our config —
   *  i.e. attacker-controlled text. Already sanitised (see token-label.ts), but
   *  the flag must survive to the UI: an untrusted row is never merged into a
   *  trusted one and never rendered as a link. */
  untrusted?: boolean;
  /** Untrusted label that reads like an advert ("View Airdrops at …"). Shown
   *  with an explicit "not verified" marker so brand context isn't mistaken for
   *  endorsement. */
  hostileLabel?: boolean;
  /** Full name from the indexer, sanitised — for the row's second line. */
  name?: string;
  /** Logo do token, quando o indexador tem. Enfeite, não credencial: token de
   *  phishing também traz logo. A marca `untrusted` continua mandando. */
  icon?: string | null;
};

/** A wallet's contribution to a total, as a reading rather than a number.
 *
 *  A wallet with a failed chain has a PARTIAL balance. That partial is worth
 *  showing on its own row — it's what we did see — but it is not what the
 *  wallet holds, so it cannot enter a sum that claims to be the treasury. The
 *  failure branch gets a reason and no access to the partial, which is the
 *  whole point of the shape. */
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
  /**
   * Totals are READINGS, not numbers. Before this, a wallet whose read failed
   * arrived with `error` set and `totalUsd: 0`, and the sum took the zero and
   * dropped the error — so the headline number silently claimed completeness
   * it did not have. On a page someone opens to decide a payment, that number
   * doesn't merely misinform, it decides.
   */
  evmTotal: Reading<number>;
  hiveTotal: Reading<number>;
  total: Reading<number>;
  /**
   * How many wallets and accounts actually answered, and which didn't.
   *
   * `sumReadings` carries only the FIRST bad reason, which is enough to refuse
   * the sum and not enough to act on. "Incomplete" alone is anxiety; "2 of 7
   * didn't answer, these two" is a next step. So the count and the names ride
   * alongside — the module summarises, this names.
   */
  health: ReturnType<typeof readHealth>;
  unreadLabels: string[];
  prices: { hive: number; hbd: number };
  hiveApr: HiveApr | null;
};

/** A wallet answers fully, or it doesn't answer. A partial is not a balance. */
export const evmWalletReading = (w: EvmWalletReport): Reading<number> =>
  w.failedChains.length > 0
    ? unread(`${w.label}: ${w.failedChains.join(", ")} não respondeu`)
    : ok(w.totalUsd);

/** "account not found" is a failed read, not an account worth zero. */
export const hiveAccountReading = (a: HiveAccountReport): Reading<number> =>
  a.error ? unread(`${a.label}: ${a.error}`) : ok(a.usd);

// --- prices -----------------------------------------------------------------

/** `eth` is NULL when CoinGecko didn't give us a price. It used to fall back to
 *  0, which was the same bug class as a failed read showing as an empty wallet:
 *  every ETH holding got valueUsd = balance * 0 = 0, and the dust filter then
 *  deleted it from the page. Unknown is not zero — a null price makes the ETH
 *  row show its quantity with "USD n/d" instead of vanishing. */
export async function getPrices(): Promise<{ hive: number; hbd: number; eth: number | null; mor: number | null }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=hive,hive_dollar,ethereum,morpheusai&vs_currencies=usd",
      { next: { revalidate: 300, tags: ["treasury"] } },
    );
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const eth = data.ethereum?.usd;
    const mor = data.morpheusai?.usd;
    return {
      hive: data.hive?.usd ?? 0.21,
      hbd: data.hive_dollar?.usd ?? 1.0,
      eth: typeof eth === "number" && eth > 0 ? eth : null,
      // Sem preço não inventamos zero: a quantidade aparece e o USD fica
      // indisponível (regra 5), igual ao ETH acima.
      mor: typeof mor === "number" && mor > 0 ? mor : null,
    };
  } catch {
    // HIVE/HBD keep the constants skatehive.app uses; ETH has no sane constant,
    // so it stays unknown rather than becoming a made-up number.
    return { hive: 0.21, hbd: 1.0, eth: null, mor: null };
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
// Read in ASSET terms via convertToAssets(balanceOf) — never the share balance;
// see vaultPosition() for why maxWithdraw alone is not enough.
type Erc4626Vault = { address: string; symbol: string; decimals: number };

/** Extra known ERC-20s to also read for a SPECIFIC wallet (config-driven, e.g.
 *  the SOPA Safe's USDCx + $gnars). `usd: "one"` prices 1:1 (Super USDC);
 *  `usd: "none"` = balance known but NO trustworthy price → rule 5 (show the
 *  quantity, USD unavailable). A token name here is TRUSTED — a human wrote it.
 *  That is what separates these from enumerated tokens, whose names come from
 *  the chain and are treated as hostile text (see fetchEnumeratedTokens). Only
 *  trusted tokens may show a quantity with no price. */
export type ExtraToken = { chain: string; address: string; symbol: string; decimals: number; usd: "one" | "none"; note?: string };

/** Posição travada num subnet de Builders do Morpheus. NÃO é ERC-4626, então o
 *  leitor de vault não a enxerga — e sem isto o token some do tesouro no dia em
 *  que é colocado em stake, o que na tela lê como PERDA em vez de movimento.
 *  Foi exatamente o que aconteceu com o multisig da SkateHive. */
type BuilderStake = { contract: string; subnetId: string; symbol: string; decimals: number; price: "mor" };

type EvmChain = { key: string; rpcs: string[]; usdc: string; vaults?: Erc4626Vault[]; tokens?: Erc4626Vault[]; stakes?: BuilderStake[] };
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
    // MOR parado na carteira. Nome escrito por nós, não por indexador.
    tokens: [{ address: "0x7431aDa8a591C955a994a21710752EF9b882b8e3", symbol: "MOR", decimals: 18 }],
    // MOR em stake no subnet de Builders — ver BuilderStake.
    stakes: [
      {
        contract: "0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9",
        subnetId: "0xf129111951997d1c386be9b7de27d4c74490c42ad0ffbcb65e380d17f8a8ea3d",
        symbol: "MOR (staked)",
        decimals: 18,
        price: "mor",
      },
    ],
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

// --- enumerated (untrusted) tokens -------------------------------------------
// Blockscout v2, keyless — the same indexer revenue-onchain.ts already uses from
// Vercel. This is the path the config-driven reader deliberately avoided,
// because enumerating everything a wallet holds also enumerates everything
// anyone airdropped into it. Measured on the SkateHive wallets: 27 and 50
// ERC-20s, of which 1 and 1 are worth over fifty cents. The rest is spam, and
// one of them is a phishing advert wearing a token's clothes.
//
// The filter below is therefore not a nicety bolted on after — it is the reason
// this function is allowed to exist:
//
//   1. A RELIABLE PRICE IS REQUIRED. No exchange_rate from the indexer ⇒ the
//      token is dropped. This is what keeps "View Airdrops at https://airdapp.net"
//      off the page: scam tokens have no market. Note this is STRICTER than the
//      rule for config-declared tokens, which may legitimately show a quantity
//      with "USD n/d" (rule 5) — the difference is that a human vouched for those.
//   2. The value must clear the same $0.50 dust floor as everything else.
//   3. Whatever survives is still UNTRUSTED text: sanitised, length-capped,
//      flagged, never a link, never merged into a trusted row.

const BLOCKSCOUT_TOKENS_HOST: Record<string, string> = {
  base: "base.blockscout.com",
  ethereum: "eth.blockscout.com",
  optimism: "optimism.blockscout.com",
  arbitrum: "arbitrum.blockscout.com",
};

/** Min USD for an enumerated token to be worth a row. Same floor the rest of
 *  the treasury uses — a scam token that somehow has a price still has to be
 *  worth more than half a dollar to earn space. */
const ENUMERATED_MIN_USD = 0.5;

type BlockscoutTokenItem = {
  value?: string;
  token?: {
    symbol?: string;
    name?: string;
    decimals?: string | number;
    /** Blockscout v2 returns `address_hash`. It used to be `address`, and reading
     *  only the old name silently disabled the whole dedup below: every trusted
     *  token (USDC above all) came back a SECOND time from the indexer, priced,
     *  and the total counted it twice. Read both, new name first. */
    address_hash?: string;
    address?: string;
    exchange_rate?: string | null;
  };
};

/**
 * Every ERC-20 the indexer says `address` holds on one chain, reduced to the
 * ones with a real, priced position. Returns [] on ANY failure: enumeration is
 * an ENRICHMENT of the authoritative RPC read, so a flaky indexer must never
 * turn into a failed chain or a missing balance. The trusted tokens are read
 * over RPC regardless.
 */
async function fetchEnumeratedTokens(address: string, chainKey: string, skipAddresses: Set<string>): Promise<EvmToken[]> {
  const host = BLOCKSCOUT_TOKENS_HOST[chainKey];
  if (!host) return [];
  try {
    const res = await fetch(`https://${host}/api/v2/addresses/${address}/tokens?type=ERC-20`, {
      signal: AbortSignal.timeout(9000),
      next: { revalidate: 300, tags: ["treasury"] },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: BlockscoutTokenItem[] };
    const out: EvmToken[] = [];
    for (const item of json.items ?? []) {
      const t = item.token ?? {};
      const contract = (t.address_hash ?? t.address ?? "").toLowerCase();
      // Already read over RPC as a trusted token — the RPC value wins.
      if (contract && skipAddresses.has(contract)) continue;
      // No contract address at all means we CANNOT prove this isn't a duplicate
      // of something the RPC already counted. Dropping it loses a row; keeping
      // it double-counts money. Lose the row.
      if (!contract) continue;

      // (1) reliable price required
      const rate = t.exchange_rate == null ? NaN : Number(t.exchange_rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;

      const decimals = Number(t.decimals ?? 18);
      const raw = Number(item.value ?? "0");
      if (!Number.isFinite(decimals) || !Number.isFinite(raw) || raw <= 0) continue;
      const balance = raw / 10 ** decimals;
      const valueUsd = balance * rate;

      // (2) dust floor
      if (!(valueUsd >= ENUMERATED_MIN_USD)) continue;

      // (3) the label is attacker-controlled until proven otherwise
      const symbol = sanitizeTokenLabel(t.symbol, SYMBOL_MAX) || "?";
      const name = sanitizeTokenLabel(t.name, NAME_MAX);
      out.push({
        symbol,
        name: name || undefined,
        chain: chainKey,
        balance,
        valueUsd,
        untrusted: true,
        hostileLabel: labelLooksHostile(symbol, name),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Native ETH + native USDC + staked USDC (+ configured extra tokens) held by
 *  `address` on one chain. A read failure returns ok:false — surfaced as a failed
 *  chain, NEVER counted as zero. */
async function fetchChainBalances(
  address: string,
  chain: EvmChain,
  ethPrice: number | null,
  extra: ExtraToken[] = [],
  enumerate = false,
  morPrice: number | null = null,
): Promise<ChainRead> {
  const padded = address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const balOf = (to: string) => rpcCall<string>(chain.rpcs, "eth_call", [{ to, data: `0x70a08231${padded}` }, "latest"]);
  const chainExtra = extra.filter((e) => e.chain === chain.key);
  try {
    const [ethHex, usdcHex, vaultAssets, extraHexes, tokenHexes, stakeHexes] = await Promise.all([
      rpcCall<string>(chain.rpcs, "eth_getBalance", [address, "latest"]),
      balOf(chain.usdc),
      Promise.all((chain.vaults ?? []).map((v) => vaultPosition(chain, v, padded))),
      Promise.all(chainExtra.map((e) => balOf(e.address))),
      Promise.all((chain.tokens ?? []).map((t) => balOf(t.address))),
      // usersData(address,bytes32) → tupla; `deposited` é o índice [2].
      Promise.all(
        (chain.stakes ?? []).map((st) =>
          rpcCall<string>(chain.rpcs, "eth_call", [
            { to: st.contract, data: `0x996cb7c3${padded}${st.subnetId.replace(/^0x/, "")}` },
            "latest",
          ]),
        ),
      ),
    ]);
    const tokens: EvmToken[] = [];
    const eth = parseInt(ethHex, 16) / 1e18;
    // No ETH price ⇒ valueUsd null (quantity shown, USD marked unavailable),
    // never balance * 0.
    if (eth > 0) tokens.push({ symbol: "ETH", chain: chain.key, balance: eth, valueUsd: ethPrice == null ? null : eth * ethPrice });
    const usdc = parseInt(usdcHex || "0x0", 16) / 1e6;
    if (usdc > 0) tokens.push({ symbol: "USDC", chain: chain.key, balance: usdc, valueUsd: usdc });
    (chain.vaults ?? []).forEach((v, i) => {
      const assets = vaultAssets[i] / 10 ** v.decimals;
      if (assets > 0) tokens.push({ symbol: v.symbol, chain: chain.key, balance: assets, valueUsd: assets });
    });
    chainExtra.forEach((e, i) => {
      const b = parseInt(extraHexes[i] || "0x0", 16) / 10 ** e.decimals;
      if (b > 0) tokens.push({ symbol: e.symbol, chain: chain.key, balance: b, valueUsd: e.usd === "one" ? b : null, note: e.note });
    });
    (chain.tokens ?? []).forEach((tk, i) => {
      const b = parseInt(tokenHexes[i] || "0x0", 16) / 10 ** tk.decimals;
      // Preço ausente ⇒ USD indisponível, nunca zero.
      if (b > 0) tokens.push({ symbol: tk.symbol, chain: chain.key, balance: b, valueUsd: morPrice == null ? null : b * morPrice });
    });
    (chain.stakes ?? []).forEach((st, i) => {
      const raw = stakeHexes[i];
      if (!raw || raw === "0x" || raw.length < 2 + 64 * 3) return;
      const deposited = parseInt(raw.slice(2 + 64 * 2, 2 + 64 * 3), 16) / 10 ** st.decimals;
      if (deposited > 0)
        tokens.push({
          symbol: st.symbol,
          chain: chain.key,
          balance: deposited,
          valueUsd: morPrice == null ? null : deposited * morPrice,
          note: "em stake no subnet de Builders — sai com unstake",
        });
    });
    if (enumerate) {
      // Everything above came from RPC and is authoritative — don't let the
      // indexer restate it. Enumeration only ADDS rows we'd otherwise miss.
      const known = new Set(
        [chain.usdc, ...(chain.vaults ?? []).map((v) => v.address), ...(chain.tokens ?? []).map((t) => t.address), ...chainExtra.map((e) => e.address)].map((a) => a.toLowerCase()),
      );
      tokens.push(...(await fetchEnumeratedTokens(address, chain.key, known)));
    }
    return { ok: true, tokens };
  } catch (e) {
    return { ok: false, chain: chain.key, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * An ERC-4626 position in ASSET terms, never in shares.
 *
 * `convertToAssets(balanceOf(owner))` is the correct read and is tried first:
 * `maxWithdraw` returns 0 on vaults whose liquidity sits in an adapter (the V2
 * case documented in vault-depositors.ts), which would show a funded position
 * as empty. maxWithdraw stays as the fallback for vaults where convertToAssets
 * is missing. Returns raw units; the caller applies decimals.
 */
async function vaultPosition(chain: EvmChain, vault: Erc4626Vault, paddedOwner: string): Promise<number> {
  const call = (data: string) => rpcCall<string>(chain.rpcs, "eth_call", [{ to: vault.address, data }, "latest"]);
  try {
    const sharesHex = await call(`0x70a08231${paddedOwner}`); // balanceOf(owner)
    const shares = BigInt(sharesHex || "0x0");
    if (shares === BigInt(0)) return 0;
    // 0x07a2d13a = convertToAssets(uint256)
    const assetsHex = await call(`0x07a2d13a${shares.toString(16).padStart(64, "0")}`);
    const assets = parseInt(assetsHex || "0x0", 16);
    if (assets > 0) return assets;
  } catch {
    // fall through to maxWithdraw
  }
  // 0xce96cb77 = maxWithdraw(address)
  return parseInt((await call(`0xce96cb77${paddedOwner}`)) || "0x0", 16);
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
  ethPrice: number | null,
  morPrice: number | null = null,
): Promise<EvmWalletReport> {
  // Query every chain in parallel. A chain whose read FAILS is recorded in
  // failedChains (its balances are UNKNOWN, not zero) — never silently dropped.
  // Enumeration is ON for every portal, client ones included: a brand should see
  // what its own treasury actually holds, not only what someone remembered to
  // declare in config. Safe to enable because the enumerated path requires a
  // real price and treats every label as hostile text.
  const reads = await Promise.all(
    EVM_CHAINS.map((c) => fetchChainBalances(wallet.address, c, ethPrice, wallet.extraTokens ?? [], true, morPrice)),
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

export type AddressBalance = {
  address: string;
  chain: string | null;
  totalUsd: number;
  tokens: EvmToken[];
  failedChains: string[];
  error?: string;
  /** Which reader produced this. A multi-chain read prefers Zerion (ONE request
   *  for every chain instead of one per chain); "rpc" means Zerion was absent or
   *  failed and the per-chain fan-out took over. Surfaced so a number is never
   *  ambiguous about where it came from. */
  source?: "zerion" | "rpc";
};

/**
 * Live native-ETH + USDC balance of any address (wallet, contract, or a 0xSplits
 * split), USD-valued. `chainKey` restricts to one chain; omit for the sum across
 * all supported chains. Reuses the treasury RPC path — same numbers as /treasury.
 */
export async function fetchAddressBalance(address: string, chainKey?: string | null): Promise<AddressBalance> {
  const addr = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return { address, chain: chainKey ?? null, totalUsd: 0, tokens: [], failedChains: [], error: "endereço inválido" };
  // MULTI-CHAIN: one Zerion call covers every chain, including the four the RPC
  // list does not carry (bsc, gnosis, polygon, avalanche) — which is where the
  // swaps.pro split now lives. Falls back to the RPC fan-out when Zerion is not
  // configured or fails, so this degrades instead of breaking.
  // Preenchido quando a Zerion falha e a leitura cai no RPC, que é cego para
  // posição de protocolo. Viaja junto do número para a tela nunca apresentar um
  // total incompleto como se fosse completo.
  let protocolGap: string | undefined;
  if (!chainKey) {
    // "all": inclui posição de protocolo. Sem isso, dinheiro que saiu da
    // carteira para render some do tesouro e a tela lê como perda.
    const z = await zerionBalances(addr, "all").catch((e) => ({ ok: false as const, error: String(e) }));
    if (!z.ok) {
      // O caminho de RPC abaixo NÃO enxerga posição de protocolo. Cair nele em
      // silêncio faria a tela dizer "não tem nada em stake" quando a verdade é
      // "não conseguimos perguntar" — e num tesouro esse é o pior erro que
      // existe, porque parece um número em vez de parecer uma falha.
      protocolGap = `posições de protocolo NÃO lidas (${z.error}) — o total abaixo exclui o que está em stake/LP`;
    }
    if (z.ok) {
      const tokens = z.tokens.map(
        (t): EvmToken => ({
          symbol: t.symbol,
          chain: t.chain,
          balance: t.balance,
          valueUsd: t.valueUsd,
          untrusted: t.untrusted,
          hostileLabel: t.suspicious,
          icon: t.icon,
          // Posição de protocolo ganha rótulo: "MOR" solto e "MOR em stake" são
          // dinheiros com liquidez diferente e não podem ler igual.
          note: t.kind && t.kind !== "wallet" ? `${t.kind}${t.protocol ? ` · ${t.protocol}` : ""}` : undefined,
        }),
      );
      return { address: addr, chain: null, totalUsd: z.totalUsd, tokens, failedChains: [], source: "zerion" };
    }
  }

  const chains = chainKey ? EVM_CHAINS.filter((c) => c.key === chainKey) : EVM_CHAINS;
  if (chains.length === 0) return { address: addr, chain: chainKey ?? null, totalUsd: 0, tokens: [], failedChains: [], error: `chain desconhecida: ${chainKey}` };
  const { eth, mor } = await getPrices();
  const reads = await Promise.all(chains.map((c) => fetchChainBalances(addr, c, eth, [], false, mor)));
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
    error: [protocolGap, failedChains.length ? `leitura falhou: ${failedChains.join(", ")}` : null].filter(Boolean).join(" · ") || undefined,
    source: "rpc",
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
    Promise.all(cfg.ethWallets.map((w) => fetchEvmWallet(w, prices.eth, prices.mor))),
    cfg.hiveAccounts?.length
      ? fetchHiveAccounts(cfg.hiveAccounts, prices)
      : Promise.resolve({ reports: [] as HiveAccountReport[], apr: null as HiveApr | null }),
  ]);
  const hive = hiveRes.reports;

  // Summed from the LEAVES, not from the two subtotals: chaining sums would
  // stack "total incomplete — total incomplete — …" onto the reason.
  const evmReadings = evm.map(evmWalletReading);
  const hiveReadings = hive.map(hiveAccountReading);
  const all = [...evmReadings, ...hiveReadings];
  return {
    evm,
    hive,
    evmTotal: sumReadings(evmReadings),
    hiveTotal: sumReadings(hiveReadings),
    total: sumReadings(all),
    health: readHealth(all),
    unreadLabels: [
      ...evm.filter((w) => w.failedChains.length > 0).map((w) => w.label),
      ...hive.filter((a) => a.error).map((a) => a.label),
    ],
    prices,
    hiveApr: hiveRes.apr,
  };
}
