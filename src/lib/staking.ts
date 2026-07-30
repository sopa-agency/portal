import "server-only";

// Morpho staking (the "Superstaking" bucket). Principal sits in a MetaMorpho
// ERC-4626 vault on Base earning yield; the Safe owns the shares. Read-only
// here — deposits/withdrawals are proposed to the Safe elsewhere.

export const MORPHO = {
  chainId: 8453,
  rpc: "https://mainnet.base.org",
  // Moonwell Flagship USDC — MetaMorpho vault, asset = native USDC (verified).
  vault: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
  vaultName: "Moonwell Flagship USDC",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdcDecimals: 6,
  api: "https://blue-api.morpho.org/graphql",
} as const;

export type StakePosition = {
  valueUsd: number; // current value of the Safe's shares (principal + accrued)
  apy: number | null; // net APY (fraction, e.g. 0.045)
  monthlyYieldUsd: number | null;
  /** Net USDC put in (deposits − withdrawals), from on-chain transfers. */
  netDepositedUsd: number | null;
  /** Yield accrued so far = current value − net deposited. Null if unknown. */
  harvestableUsd: number | null;
  /** True when the read failed — the numbers above are NOT observed. Consumers
      must show a "não consegui ler" state, never a $0 that looks like an empty
      position (a genuine empty position returns valueUsd:0 WITHOUT this flag). */
  failed?: boolean;
};

/**
 * Net USDC deposited into the vault by `safe` — the vault auto-compounds yield
 * into the share price, so there's no separate rewards balance: what's
 * harvestable is `current value − net deposited`. Read from Blockscout token
 * transfers between the Safe and the vault (the public RPC caps eth_getLogs).
 */
async function fetchNetDeposited(safe: string): Promise<number | null> {
  const vault = MORPHO.vault.toLowerCase();
  const usdc = MORPHO.usdc.toLowerCase();
  try {
    let url: string | null = `https://base.blockscout.com/api/v2/addresses/${safe}/token-transfers?type=ERC-20`;
    let deposited = 0;
    let withdrawn = 0;
    for (let page = 0; url && page < 5; page++) {
      const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 300, tags: ["stake"] } });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        items?: { token?: { address?: string; address_hash?: string }; from?: { hash?: string }; to?: { hash?: string }; total?: { value?: string; decimals?: string } }[];
        next_page_params?: Record<string, string> | null;
      };
      for (const t of json.items ?? []) {
        const token = (t.token?.address ?? t.token?.address_hash ?? "").toLowerCase();
        if (token !== usdc) continue;
        const from = (t.from?.hash ?? "").toLowerCase();
        const to = (t.to?.hash ?? "").toLowerCase();
        const value = Number(t.total?.value ?? 0) / 10 ** Number(t.total?.decimals ?? MORPHO.usdcDecimals);
        if (to === vault) deposited += value;
        if (from === vault) withdrawn += value;
      }
      const next = json.next_page_params;
      url = next ? `https://base.blockscout.com/api/v2/addresses/${safe}/token-transfers?type=ERC-20&${new URLSearchParams(next)}` : null;
    }
    return deposited - withdrawn;
  } catch {
    return null;
  }
}

async function ethCall(to: string, data: string): Promise<string> {
  const res = await fetch(MORPHO.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to, data }, "latest"], id: 1 }),
    next: { revalidate: 60, tags: ["stake"] },
  });
  const json = (await res.json()) as { result?: string };
  return json.result ?? "0x";
}

async function fetchApy(): Promise<number | null> {
  try {
    const res = await fetch(MORPHO.api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($a:String!){ vaultByAddress(address:$a, chainId:8453){ state{ netApy } } }`,
        variables: { a: MORPHO.vault },
      }),
      next: { revalidate: 600, tags: ["stake"] },
    });
    const json = (await res.json()) as { data?: { vaultByAddress?: { state?: { netApy?: number } } } };
    const apy = json.data?.vaultByAddress?.state?.netApy;
    return typeof apy === "number" ? apy : null;
  } catch {
    return null;
  }
}

/** Current value of the SOPA Safe's position in the vault + the vault's APY. */
export async function getStakePosition(safe: string): Promise<StakePosition> {
  try {
    const shares = await ethCall(MORPHO.vault, `0x70a08231000000000000000000000000${safe.slice(2).toLowerCase()}`);
    const sharesBn = shares && shares !== "0x" ? BigInt(shares) : BigInt(0);
    let valueUsd = 0;
    if (sharesBn > BigInt(0)) {
      // convertToAssets(uint256) → assets (6-dec USDC)
      const arg = sharesBn.toString(16).padStart(64, "0");
      const assets = await ethCall(MORPHO.vault, `0x07a2d13a${arg}`);
      valueUsd = assets && assets !== "0x" ? Number(BigInt(assets)) / 10 ** MORPHO.usdcDecimals : 0;
    }
    const [apy, netDeposited] = await Promise.all([fetchApy(), valueUsd > 0 ? fetchNetDeposited(safe) : Promise.resolve(null)]);
    // Yield accrued = value now − what we put in. Clamp tiny negatives (rounding).
    const harvestable = netDeposited == null ? null : Math.max(0, valueUsd - netDeposited);
    return {
      valueUsd,
      apy,
      monthlyYieldUsd: apy != null ? (valueUsd * apy) / 12 : null,
      netDepositedUsd: netDeposited,
      harvestableUsd: harvestable,
    };
  } catch {
    // Read failed — flag it. Returning a bare $0 here would be indistinguishable
    // from a real empty position, exactly the "wrong number" this page refuses.
    return { valueUsd: 0, apy: null, monthlyYieldUsd: null, netDepositedUsd: null, harvestableUsd: null, failed: true };
  }
}
