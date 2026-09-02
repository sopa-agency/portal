import "server-only";
import { createPublicClient, http, fallback, formatUnits, getAddress } from "viem";
import { base } from "viem/chains";
import { SOPA_SAFE } from "@/lib/superfluid";

// Community staking: people deposit into an ERC-4626 vault, keep the right to
// withdraw at any time, and a share of the interest goes to a fee recipient.
//
// The split is NOT something this app decides — it lives in the vault contract
// (`fee` + `feeRecipient`). We read both on-chain so the UI can state where the
// yield actually goes instead of claiming a split we can't prove. A vault whose
// feeRecipient isn't the SOPA Safe funds NOTHING for the payroll, and the UI
// has to say so.

export type CommunityVault = {
  key: string;
  label: string;
  /** Vault contract (ERC-4626 / MetaMorpho). */
  address: string;
  /** Underlying token users deposit. */
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  chainId: number;
  note?: string;
  /**
   * Vault V2 only: the adapter the deposits are deployed into. The vault keeps
   * ZERO idle USDC, so a plain withdraw reverts — the money has to be pulled
   * back from here first (`forceDeallocate`, permissionless). Without this
   * address the withdraw button can only fail with a bare contract error.
   */
  liquidityAdapter?: string;
};

export const COMMUNITY_VAULTS: CommunityVault[] = [
  {
    key: "sopa-usdc",
    label: "USDC",
    // SOPA USDC (Vault V2) — routes deposits into Moonwell Flagship through a
    // MorphoVaultV1Adapter, so Moonwell keeps curating risk and this vault only
    // takes its performance fee to the treasury.
    address: "0x3A36a1cc8Dc914D22b1Fd823695a0f4f737bCbD8",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetSymbol: "USDC",
    assetDecimals: 6,
    chainId: 8453,
    note: "Seu depósito é encaminhado pro cofre da Moonwell, que cuida da gestão de risco. A SOPA só fica com uma parte dos juros.",
    // MorphoVaultV1Adapter → Moonwell Flagship USDC. Measured on-chain: 100% of
    // the vault's assets sit here, maxRedeem reads 0 for every depositor, and
    // forceDeallocate carries a 0% penalty.
    liquidityAdapter: "0x7B43a2573224b8f88A69443E029CAF4812f7d17c",
  },
  // An ETH (WETH) vault goes here once one is deployed. Vaults are per-asset,
  // so ETH needs its own — and depositors would carry ETH price risk while the
  // payroll is denominated in dollars.
];

export type VaultInfo = {
  vault: CommunityVault;
  /** Share of the interest taken as a fee, 0–1. */
  fee: number;
  feeRecipient: string;
  /** True only when the fee actually lands in the SOPA Safe. */
  paysSopa: boolean;
  totalAssets: number;
  apy: number | null;
  /** Net APY a depositor keeps, after the vault fee. */
  depositorApy: number | null;
  error?: string;
};

// V1 (MetaMorpho) and V2 name the same concept differently. Read whichever the
// vault answers to, so a V2 vault doesn't read as "not ours" after deploy.
const V1_ABI = [
  { name: "fee", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint96" }] },
  { name: "feeRecipient", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const V2_ABI = [
  { name: "performanceFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "performanceFeeRecipient", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const TOTAL_ASSETS_ABI = [
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Fee + recipient, whichever generation the vault is. */
async function readFeeSplit(
  c: ReturnType<typeof client>,
  address: `0x${string}`,
): Promise<{ fee: number; recipient: string; version: "v1" | "v2" }> {
  try {
    const [fee, recipient] = await Promise.all([
      c.readContract({ address, abi: V1_ABI, functionName: "fee" }),
      c.readContract({ address, abi: V1_ABI, functionName: "feeRecipient" }),
    ]);
    return { fee: Number(formatUnits(fee as bigint, 18)), recipient: recipient as string, version: "v1" };
  } catch {
    const [fee, recipient] = await Promise.all([
      c.readContract({ address, abi: V2_ABI, functionName: "performanceFee" }),
      c.readContract({ address, abi: V2_ABI, functionName: "performanceFeeRecipient" }),
    ]);
    return { fee: Number(formatUnits(fee as bigint, 18)), recipient: recipient as string, version: "v2" };
  }
}

// The public Base RPC rate-limits; a single endpoint made the whole panel blank
// out intermittently. Fall through a few before giving up.
const RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"];
const client = () => createPublicClient({ chain: base, transport: fallback(RPCS.map((u) => http(u))) });

export async function fetchVaultApy(address: string): Promise<number | null> {
  try {
    const res = await fetch("https://blue-api.morpho.org/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ vaultByAddress(address:"${address}", chainId:8453) { state { netApy } } }`,
      }),
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 600, tags: ["treasury"] },
    });
    const json = (await res.json()) as { data?: { vaultByAddress?: { state?: { netApy?: number } } } };
    const apy = json.data?.vaultByAddress?.state?.netApy;
    return typeof apy === "number" ? apy : null;
  } catch {
    return null;
  }
}

export async function getVaultInfo(vault: CommunityVault): Promise<VaultInfo> {
  const base: VaultInfo = {
    vault,
    fee: 0,
    feeRecipient: "",
    paysSopa: false,
    totalAssets: 0,
    apy: null,
    depositorApy: null,
  };
  try {
    const c = client();
    const address = getAddress(vault.address);
    // Fee is WAD in both generations (1e18 = 100%).
    const [split, total, apy] = await Promise.all([
      readFeeSplit(c, address),
      c.readContract({ address, abi: TOTAL_ASSETS_ABI, functionName: "totalAssets" }),
      fetchVaultApy(vault.address),
    ]);
    return {
      ...base,
      fee: split.fee,
      feeRecipient: split.recipient,
      paysSopa: split.recipient.toLowerCase() === SOPA_SAFE.toLowerCase(),
      totalAssets: Number(formatUnits(total as bigint, vault.assetDecimals)),
      apy,
      // The published netApy is already net of the vault fee.
      depositorApy: apy,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message.slice(0, 160) : "falha ao ler o cofre" };
  }
}

export async function getCommunityVaults(): Promise<VaultInfo[]> {
  return Promise.all(COMMUNITY_VAULTS.map(getVaultInfo));
}
