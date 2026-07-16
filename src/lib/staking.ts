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
};

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
    const apy = await fetchApy();
    return { valueUsd, apy, monthlyYieldUsd: apy != null ? (valueUsd * apy) / 12 : null };
  } catch {
    return { valueUsd: 0, apy: null, monthlyYieldUsd: null };
  }
}
