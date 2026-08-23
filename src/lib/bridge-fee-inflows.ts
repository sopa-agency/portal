import "server-only";
import { aggregateInflows, type ValuedInflow, type FeeBreakdown } from "@/lib/bridge-fee-attribution";

// Verified bridge-fee inflows to the SkateHive split (0x1c04…5F21) on Base.
// Queried by hand 2026-08-22 (no live Base indexer wired into the portal yet —
// Blockscout flaky, no Alchemy key here). Amounts in ETH. The split also received
// 17 spam-token airdrops (GONE / 8 BIT / AORP / Only Trump) — excluded; only real
// ETH fee transfers are here. Replace this seed with a live fetch once an indexer
// exists; until then the panel is honest AS OF this date, not real-time.
//
// All three came from the LI.FI Fee Forwarder (the transfer `from`); the real
// payer is tx.from. All three are OURS: two were tests, and the largest was vlad
// executing a 0.6575 ETH treasury bridge through the SkateHive Safe. So external
// client revenue is ZERO so far — and the panel must say exactly that.

const LIFI_FEE_FORWARDER = "0xce40449b773a3e6e5e769adb4e567179d4828cbd";
const VLAD = "0x8bf5941d27176242745b716251943ae4892a3c26";

export const BRIDGE_FEE_AS_OF = "2026-08-22";

export const BRIDGE_FEE_INFLOWS: (ValuedInflow & { note: string })[] = [
  {
    sender: LIFI_FEE_FORWARDER,
    txFrom: VLAD, // confirmed on-chain; tx.to = SkateHive Safe (execTransaction)
    txTo: "0xc1afa4c0a70b622d7b71d42241bb4d52b6f3e218",
    usd: 0.0032877767, // ETH
    ts: "2026-08-22T22:39:51Z",
    txHash: "0x2e48bd1296e495c199fd06e0e6c03a8620641450a1904d6fe726594a77b29fc1",
    note: "Safe da SkateHive — bridge de 0,6575 ETH do tesouro (via vlad)",
  },
  {
    sender: LIFI_FEE_FORWARDER,
    txFrom: VLAD, // operator-verified internal test (full hash not captured)
    txTo: null,
    usd: 0.0005, // ETH
    ts: "2026-08-22T20:42:01Z",
    txHash: "0xd5509996f4f2be2c",
    note: "teste interno",
  },
  {
    sender: LIFI_FEE_FORWARDER,
    txFrom: VLAD, // confirmed on-chain
    txTo: "0xf82e7290d6538fe365a0ed4e4afb9ae9e1656485",
    usd: 0.00005, // ETH
    ts: "2026-08-22T20:07:05Z",
    txHash: "0x483b5933fbcd47882ac3a10b25e9ba86a0ad4cc9e3e302ed7c195981129394d2",
    note: "teste interno (vlad)",
  },
];

export type BridgeFeeSummary = {
  breakdown: FeeBreakdown; // amounts are ETH
  asOf: string;
  feeBps: number;
  /** 50 bps proof: 0.6575 ETH bridged × 0.005 = 0.0032875, collected 0.0032877767. */
  feeConfirmed: boolean;
  inflows: { ts: string; eth: number; note: string; txHash: string }[];
};

export function getBridgeFeeSummary(): BridgeFeeSummary {
  return {
    breakdown: aggregateInflows(BRIDGE_FEE_INFLOWS),
    asOf: BRIDGE_FEE_AS_OF,
    feeBps: 50,
    feeConfirmed: true,
    inflows: BRIDGE_FEE_INFLOWS.map((i) => ({ ts: i.ts!, eth: i.usd, note: i.note, txHash: i.txHash! })),
  };
}
