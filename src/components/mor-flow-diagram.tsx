"use client";

// Plain-language flow map of the Gnars MOR → USDC revenue pipeline, with every
// contract linked (Basescan / Splits explorer), plus an "info for agents" button
// that copies a replicate-this prompt. Rendered on the treasury Operações MOR
// section. Theme-aware (semantic tokens, light + dark).

import { useState } from "react";
import { PIPELINE } from "@/lib/mor-pipeline";
import type { SplitLeaf } from "@/lib/mor-split-tree";
import { isOk, type Reading } from "@/lib/reading";
import { Check, ExternalLink, ArrowDown, GitBranch, Bot } from "lucide-react";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

const FILLER = "0x40b2F18912FF46Dc826F522B9cbdb0224739aa66";
const scan = (a: string) => `https://basescan.org/address/${a}`;
const splitsUrl = (a: string) => `https://explorer.splits.org/accounts/${a}/?chainId=8453`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Node({ title, desc, addr, href, tone = "default" }: { title: string; desc: string; addr: string; href: string; tone?: "default" | "split" | "swap" | "out" }) {
  const ring =
    tone === "split" ? "border-accent-border" : tone === "swap" ? "border-warning/40" : tone === "out" ? "border-success/40" : "border-border";
  return (
    <div className={`w-full rounded-xl border ${ring} bg-surface p-3`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-[10px] text-foreground-faint hover:text-accent">
          {short(addr)} <ExternalLink className="inline h-2.5 w-2.5" />
        </a>
      </div>
      <p className="mt-0.5 text-xs text-foreground-muted">{desc}</p>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-3 text-[11px] text-foreground-faint">
      <ArrowDown className="h-3.5 w-3.5" />
      {label && <span>{label}</span>}
    </div>
  );
}

function Branch({ pct, to, addr, href, token }: { pct: string; to: string; addr: string; href: string; token: string }) {
  return (
    <div className="ml-6 flex items-center gap-2 rounded-lg border border-dashed border-success/40 bg-success/5 px-2.5 py-1.5 text-[11px]">
      <GitBranch className="h-3.5 w-3.5 text-success" />
      <span className="font-semibold text-success">{pct}</span>
      <span className="text-foreground-muted">→ {to} <span className="text-foreground-faint">({token})</span></span>
      <a href={href} target="_blank" rel="noopener noreferrer" className="ml-auto font-mono text-[10px] text-foreground-faint hover:text-accent">{short(addr)}</a>
    </div>
  );
}

const AGENT_PROMPT = `You are replicating the SOPA/Gnars "MOR → USDC treasury" revenue pipeline on Base (chainId 8453) for a new project. Goal: a Morpheus Builders subnet's MOR emissions get auto-converted to USDC and split to the project treasury + SOPA, all triggerable from the project's own frontend.

ARCHITECTURE (Base mainnet addresses are the live SOPA/Gnars ones — for a new project, deploy your own splits/swappers/subnet and keep the same shape):

1. Morpheus Builders subnet — BuildersV4 proxy 0x42BB446eAE6dca7723a9eBdb81EA88aFe77eF4B9. Register a subnet; MOR emissions accrue. Read accrued with getCurrentSubnetRewards(bytes32 subnetId). The subnet ADMIN calls claim(bytes32 subnetId, address receiver) to pull the MOR (receiver = the top split). MOR token 0x7431aDa8a591C955a994a21710752EF9b882b8e3 (18 dec).

2. 0xSplits v2 chain — all PullSplits: distribute((address[] recipients,uint256[] allocations,uint256 totalAllocation,uint16 distributionIncentive) _split, address _token, address _distributor) CREDITS the SplitsWarehouse 0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8; then withdraw(address _owner, address _token) pulls each recipient's credit (ERC-6909 id = uint256(uint160(token))). distribute + withdraw are permissionless. The distribute struct must hash to the on-chain config — read it from the SplitUpdated event.
   - Top split (SOPA/Gnars: 0x8438326A13CE52e4878De2389dA9bDAadFD2a88a): MOR in → 90% to Swapper A, 10% to SOPA.
   - Swapper A (0x4Ca07529d58AD588cB85929688D7a8C0ebe96F24): a 0xSplits UniV3-oracle flash Swapper, MOR → WETH. tokenToBeneficiary = WETH; oracle() prices the trade; defaultScaledOfferFactor = the discount kept as surplus.
   - Swapper B (0x7C76e08ac6b8be41CE38Ad0ad457d48B899b8074): WETH → USDC.
   - Downstream split (0xcc7E971fB6828e45C01E168849447E460FDF3A4E): USDC in → 80% SOPA, 20% project treasury.
   USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 dec), WETH 0x4200000000000000000000000000000000000006.

3. Flash filler contract — the swapper's flash(QuoteParams[], bytes) hands the input token to msg.sender and requires the output token back in the SAME tx (an EOA can't; only a contract can). Deploy a stateless SwapperFlashFiller: fill(address swapper, address tokenFromTrader, uint24 poolFee, uint256 minOut, address surplusTo) reads the swapper's balance, calls flash, and in swapperFlashCallback swaps input→output on Uniswap V3 SwapRouter02 0x2626664c2603336E57B271c5C0b26F421741e481, approves the swapper for amountToBeneficiary, and forwards the surplus to surplusTo. Pools from the swapper's own oracle: MOR/WETH fee 3000, WETH/USDC fee 500. minOut is principal-safe even at 0 (the flash reverts if UniV3 can't cover the oracle price; worst case is 0 surplus).

4. Frontend (the tool) — a treasury panel that reads each hop's balance (getCurrentSubnetRewards + ERC20 balanceOf on each split/swapper + Warehouse balanceOf) and lets any connected wallet run: claim (admin-only) → distribute + withdraw (permissionless) → fill (the swaps). Submit via raw eth_sendTransaction. IMPORTANT: tolerate smart / EIP-7702 wallets — they may broadcast yet return a -32602 "invalid parameters" error, or return a userOp hash that eth_getTransactionReceipt can't resolve. Treat only 4001 (user rejection) as a real stop; otherwise wait and let the on-chain state be the source of truth.

To stand up a NEW project's pipeline: register its own Builders subnet; deploy two 0xSplits Swappers (UniV3 oracle pointing at your-token/WETH and WETH/USDC pools) via the SwapperFactory; wire a top split (MOR X%/Y%) and a downstream split (USDC treasury%/SOPA%); deploy the SwapperFlashFiller; build the panel from the reads above.`;

export function MorFlowDiagram({ tree }: { tree: Reading<SplitLeaf[]> }) {
  const t = useT().treasury.mor;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t.diagramTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
            {rich(t.diagramHint)}
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20"
          title={t.copyPromptTitle}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          {copied ? t.copied : t.copyPrompt}
        </button>
      </div>

      <div className="mx-auto mt-5 max-w-xl">
        <Node title={t.nodeSubnet} desc={t.nodeSubnetDesc} addr={PIPELINE.builders} href={scan(PIPELINE.builders)} />
        <Arrow label={t.arrowClaim} />
        <Node title={t.nodeTopSplit} desc={t.nodeTopSplitDesc} addr={PIPELINE.topSplit} href={splitsUrl(PIPELINE.topSplit)} tone="split" />
        <Branch pct="10%" to="SOPA" token="MOR" addr={PIPELINE.sopa} href={scan(PIPELINE.sopa)} />
        <Arrow label={t.arrowDistribute} />
        <Node title={t.nodeSwapperA} desc={t.nodeSwapperADesc} addr={PIPELINE.swapperA} href={scan(PIPELINE.swapperA)} tone="swap" />
        <div className="ml-6 mt-1 flex items-center gap-2 rounded-lg border border-dashed border-warning/40 bg-warning/5 px-2.5 py-1.5 text-[11px]">
          <Bot className="h-3.5 w-3.5 text-warning" />
          <span className="text-foreground-muted">{t.filler}</span>
          <a href={scan(FILLER)} target="_blank" rel="noopener noreferrer" className="ml-auto font-mono text-[10px] text-foreground-faint hover:text-accent">{short(FILLER)}</a>
        </div>
        <Arrow />
        <Node title={t.nodeSwapperB} desc={t.nodeSwapperBDesc} addr={PIPELINE.swapperB} href={scan(PIPELINE.swapperB)} tone="swap" />
        <Arrow label={t.arrowDistributeShort} />
        <Node
          title={t.nodeFinalSplit}
          desc={
            isOk(tree)
              ? `Divide o USDC entre ${tree.value.length} destinatários, lidos da cadeia agora.`
              : t.nodeFinalSplitDesc
          }
          addr={PIPELINE.downstreamSplit}
          href={splitsUrl(PIPELINE.downstreamSplit)}
          tone="split"
        />

        {/*
          Os destinatários vêm da CADEIA, não do dicionário. O texto fixo dizia
          "80% SOPA, 20% Gnars" e ficou um dia inteiro errado depois que o split
          foi refeito para 40/40/20 — afirmando com a mesma confiança de antes.
        */}
        {!isOk(tree) ? (
          <div className="ml-6 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
            ⚠ Não consegui ler os destinatários deste split na cadeia
            {tree.state === "unread" ? ` — ${tree.reason}` : ""}. Isto NÃO quer dizer que ele não
            tem destinatários; quer dizer que eu não sei quais são agora.
          </div>
        ) : (
          tree.value.map((leaf) => {
            const pct = `${(leaf.share * 100).toFixed(leaf.share * 100 % 1 === 0 ? 0 : 1)}%`;
            const nome =
              leaf.ens ??
              (leaf.address.toLowerCase() === PIPELINE.sopa.toLowerCase()
                ? "SOPA (tesouro)"
                : leaf.address.toLowerCase() === PIPELINE.gnarsTreasury.toLowerCase()
                  ? t.gnarsTreasury                    : leaf.nestedState === "ok" && leaf.nested
                      ? `split da equipe — ${leaf.nested.length} pessoas`
                      : short(leaf.address));
            return (
              <div key={leaf.address}>
                <Branch
                  pct={pct}
                  to={nome}
                  token="USDC"
                  addr={leaf.address}
                  href={leaf.nested ? splitsUrl(leaf.address) : scan(leaf.address)}
                />
                {leaf.nestedState === "unread" && (
                  <p className="ml-14 mt-1 text-[11px] text-warning">
                    ⚠ não consegui ler quem recebe deste endereço
                    {leaf.nestedReason ? ` — ${leaf.nestedReason}` : ""}. Pode haver gente atrás
                    dele; eu é que não sei dizer quem agora.
                  </p>
                )}
                {leaf.nestedState === "ok" && leaf.nested && (
                  <ul className="ml-14 mt-1 space-y-0.5 border-l border-border pl-3">
                    {leaf.nested.map((n) => (
                      <li key={n.address} className="flex items-center gap-2 text-[11px]">
                        <span className="tabular-nums font-medium text-foreground-muted">
                          {(n.share * 100).toFixed(n.share * 100 % 1 === 0 ? 0 : 1)}%
                        </span>
                        <a
                          href={scan(n.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground-subtle hover:text-accent"
                        >
                          {n.ens ?? short(n.address)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
