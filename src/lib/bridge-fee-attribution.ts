import "server-only";

// Source-level attribution for the SkateHive fee split (0x1c04…5F21).
//
// The split commingles TWO fee sources — confirmed in skatehive3.0 code:
//   • swap fees  → 0x Protocol (getSwapFeeRecipient → the split), 50 bps
//   • bridge fees → LI.FI integrator "gnars" (getQuote fee → the split), 50 bps
// So the split's balance / SplitDistributed total CANNOT tell you how much is
// bridge revenue. This module attributes each inflow by EVIDENCE, not by the
// receiving address — the same discipline that fixed the Gnars treasury page.
//
// The portal closes SOPA's books, so "internal" means SOPA's own money only.
// Two axes per inflow:
//   1. SOURCE  — the inflow's immediate sender: LI.FI fee forwarder → "bridge";
//      a known 0x settler → "swap"; anything else → "undetermined" (never guessed).
//   2. ORIGINATOR — who initiated the tx (tx.from, or the Safe it executed on).
//      The transfer's `from` is ALWAYS the LI.FI Fee Forwarder, so it can't tell
//      you who paid — tx.from does:
//        • "sopa" / "intra-group" → our own wallets (SOPA treasury, SkateHive,
//          Gnars, team, tests). INTERNAL — our own money moving, not client revenue.
//        • "adoption" → a resolved originator OUTSIDE the group → real CLIENT revenue.
//        • "unknown"  → no originator resolved → undetermined, never counted.
//
// Client revenue = source "bridge" AND originator "adoption". Everything in-house
// is internal/test — counting our own treasury moves as client revenue would
// inflate the number, and a panel that lies now isn't trusted later.

export const SKATEHIVE_SPLIT = "0x1c043b5c01e7d29f85493830b98eb182bd205f21";

// Immediate senders that PROVE a bridge fee. 0xce40…8cbd is LI.FI's Fee
// Forwarder (the contract that replaced the Fee Collector on 2026-04-08 —
// verified on-chain as the sender of the first fee, tx 0x483b…94d2). The Diamond
// is kept defensively; add new LI.FI executors here as they're observed.
const LIFI_FEE_SENDERS = new Set([
  "0xce40449b773a3e6e5e769adb4e567179d4828cbd", // LI.FI Fee Forwarder (confirmed)
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", // LI.FI Diamond (defensive)
]);

// Immediate senders that PROVE a swap fee (0x Protocol settlers on Base). Empty
// until confirmed on-chain from a real swap-fee inflow — an unconfirmed 0x sender
// must fall through to "undetermined", never be assumed.
const SWAP_FEE_SENDERS = new Set<string>([]);

// SOPA's own wallets — the ONLY addresses that count as internal. A bridge these
// originate is SOPA moving its own money and is excluded from revenue.
const SOPA_WALLETS = new Set([
  "0x96c37393b79ad7eabdf9ccf82c2edad3d3c0eea2", // SOPA Safe
]);

// Known in-house wallets that are NOT SOPA. Bridges from these ARE SOPA revenue,
// but flagged as intra-group (treasury flywheel) rather than external adoption.
const INTRA_GROUP = new Set([
  "0xc1afa4c0a70b622d7b71d42241bb4d52b6f3e218", // SkateHive Safe
  "0x72ad986ebac0246d2b3c565ab2a1ce3a14ce6f88", // Gnars DAO treasury
  "0x8bf5941d27176242745b716251943ae4892a3c26", // haxixe.eth / vlad
  "0xf82e7290d6538fe365a0ed4e4afb9ae9e1656485", // SkateHive Safe owner / signer
  "0xdb1cb916373416fc900a8533ce02aff3faa62cdf", // SkateHive Safe owner
  "0x1273261b09dc30d0b6ce460d7cab5820fa42e38c", // SkateHive Safe owner
  "0x761b4763a572010f96ed7c22011d0c95e2b36693", // SkateHive Safe owner
  "0xb4964e1eca55db36a94e8aeffbfbab48529a2f6c", // SkateHive Safe owner
]);

export type FeeSource = "bridge" | "swap" | "undetermined";
export type Originator = "sopa" | "intra-group" | "adoption" | "unknown";

export type InflowEvidence = {
  /** immediate sender of the fee transfer (internal ETH or ERC-20 `from`). */
  sender: string;
  /** parent tx originator (tx.from). */
  txFrom: string | null;
  /** parent tx target — a Safe execTransaction here means the Safe is the actor. */
  txTo: string | null;
};

const cat = (a: string): "sopa" | "intra-group" | "other" =>
  SOPA_WALLETS.has(a) ? "sopa" : INTRA_GROUP.has(a) ? "intra-group" : "other";

/** Pure, deterministic classification from on-chain evidence. Unit-testable, no
 *  network. Unknown sender → source "undetermined"; unknown originator →
 *  "unknown" (we don't guess it isn't SOPA). */
export function classifyInflow(ev: InflowEvidence): { source: FeeSource; originator: Originator } {
  const sender = ev.sender.toLowerCase();
  const source: FeeSource = LIFI_FEE_SENDERS.has(sender)
    ? "bridge"
    : SWAP_FEE_SENDERS.has(sender)
      ? "swap"
      : "undetermined";

  const from = ev.txFrom?.toLowerCase() ?? null;
  const to = ev.txTo?.toLowerCase() ?? null;
  const f = from ? cat(from) : null;
  const t = to ? cat(to) : null;
  let originator: Originator;
  if (f === "sopa" || t === "sopa") originator = "sopa"; // SOPA anywhere → internal
  else if (f === "intra-group" || t === "intra-group") originator = "intra-group";
  else if (from == null) originator = "unknown";
  else originator = "adoption";

  return { source, originator };
}

// The metric that matters is CLIENT revenue — outside people using the widget.
// Our own money moving (SOPA treasury, SkateHive/Gnars, any team wallet, tests)
// is NOT client revenue: counting it inflates the number, and a panel that lies
// now isn't trusted later. So external = adoption only; everything in-house is
// internal/test. (The transfer's `from` is ALWAYS the LI.FI Fee Forwarder — the
// real payer is tx.from, which is what decides internal vs external.)
export const isExternalClientRevenue = (c: { source: FeeSource; originator: Originator }): boolean =>
  c.source === "bridge" && c.originator === "adoption";

/** Our own group's bridge (SOPA / SkateHive / Gnars / team / tests). */
export const isInternalBridge = (c: { source: FeeSource; originator: Originator }): boolean =>
  c.source === "bridge" && (c.originator === "sopa" || c.originator === "intra-group");

// --- aggregation ------------------------------------------------------------
// Roll classified inflows into the SOPA-book breakdown. USD amounts are the GROSS
// fee that landed in the split; SOPA's actual revenue = gross × the split's SOPA
// share (50%, read from the split config in the revenue orbit — NOT hardcoded here).
export type ValuedInflow = InflowEvidence & { usd: number; ts?: string; txHash?: string };

export type FeeBreakdown = {
  /** Total bridge fee collected (all proven-bridge inflows). */
  totalGross: number;
  /** Real client revenue — bridges from outside the group (adoption). */
  externalClientGross: number;
  /** Our own money moving: SOPA / SkateHive / Gnars / team / tests. */
  internalTestGross: number;
  /** Unknown sender (not proven bridge) or unresolved originator — never counted. */
  undeterminedGross: number;
  counts: { external: number; internal: number; undetermined: number; total: number };
};

/** Aggregate valued inflows (amount in whatever unit `usd` carries — USD or ETH)
 *  into the client-vs-internal breakdown. */
export function aggregateInflows(inflows: ValuedInflow[]): FeeBreakdown {
  const b: FeeBreakdown = {
    totalGross: 0, externalClientGross: 0, internalTestGross: 0, undeterminedGross: 0,
    counts: { external: 0, internal: 0, undetermined: 0, total: 0 },
  };
  for (const it of inflows) {
    const c = classifyInflow(it);
    const amt = it.usd || 0;
    b.counts.total++;
    if (isExternalClientRevenue(c)) {
      b.externalClientGross += amt;
      b.totalGross += amt;
      b.counts.external++;
    } else if (isInternalBridge(c)) {
      b.internalTestGross += amt;
      b.totalGross += amt;
      b.counts.internal++;
    } else {
      b.undeterminedGross += amt;
      b.counts.undetermined++;
    }
  }
  return b;
}
