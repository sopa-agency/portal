"use client";

import { useState, useTransition } from "react";
import { Loader2, ExternalLink, Sprout, Droplets, Zap, Square, RefreshCw, ChevronDown } from "lucide-react";
import { proposeSetUnits, proposeWrap, proposeSetFlow, proposeAutoWrap } from "@/app/actions/superfluid";
import { proposeHarvest } from "@/app/actions/staking";
import { usd } from "@/lib/format";
import { useT } from "@/components/locale-provider";
import { rich } from "@/components/rich-text";

type Result = { ok: true; url: string } | { ok: false; error: string } | null;

function Feedback({ r }: { r: Result }) {
  const t = useT().treasury.streamActions;
  if (!r) return null;
  return r.ok ? (
    <p className="mt-2 text-[11px] text-foreground-muted">
      {t.queued}{" "}
      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
        {t.openSafe} <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  ) : (
    <p className="mt-2 text-[11px] text-danger">{r.error}</p>
  );
}

function StepCard({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-1.5 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-bg font-mono text-[11px] font-bold text-accent">
          {n}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Guided, data-aware controls for the payroll stream — one ordered place instead
 * of buttons scattered across panels. Steps fill the buffer (the "tank"), set a
 * recommended flow (the "tap"), and turn on the auto-pilot. Recommended values
 * are pre-filled and a guardrail warns before the flow exceeds what the yield
 * covers. Everything is proposed to the Safe; owners sign.
 */
export function StreamActions({
  canEdit,
  yieldMonthly,
  bufferUsd,
  harvestableUsd,
  currentFlowMonthly,
}: {
  canEdit: boolean;
  /** What the stake throws off per month — the sustainable ceiling for the flow. */
  yieldMonthly: number | null;
  /** USDCx sitting ready to stream (the tank). */
  bufferUsd: number;
  /** Yield accrued in the vault, ready to harvest into the buffer. */
  harvestableUsd: number | null;
  /** The stream's current rate, $/month. */
  currentFlowMonthly: number;
}) {
  const dict = useT().treasury;
  const t = dict.streamActions;
  const sustainable = yieldMonthly && yieldMonthly > 0 ? yieldMonthly : null;
  const recFlow = sustainable ? sustainable.toFixed(2) : "";
  const recHarvest =
    harvestableUsd != null && harvestableUsd > 0 ? harvestableUsd.toFixed(harvestableUsd < 1 ? 4 : 2) : "";

  const [harvestAmt, setHarvestAmt] = useState(recHarvest);
  const [flowAmt, setFlowAmt] = useState(recFlow);
  const [allowance, setAllowance] = useState("500");
  const [advanced, setAdvanced] = useState(false);
  const [wrapAmt, setWrapAmt] = useState("");

  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [res, setRes] = useState<Record<string, Result>>({});

  if (!canEdit) return null;

  const run = (key: string, fn: () => Promise<Result>) =>
    start(async () => {
      setBusyKey(key);
      setRes((r) => ({ ...r, [key]: null }));
      const out = await fn();
      setRes((r) => ({ ...r, [key]: out }));
      setBusyKey(null);
    });
  const busy = (k: string) => pending && busyKey === k;

  // Guardrail: a flow meaningfully above the yield eats the principal.
  const flowNum = Number(flowAmt);
  const overSustainable = sustainable != null && Number.isFinite(flowNum) && flowNum > sustainable * 1.05;

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-subtle">
        {t.intro}
      </p>

      {/* 1 — fill the tank */}
      <StepCard n={1} title={t.step1}>
        <p className="mb-2 text-[11px] text-foreground-subtle">
          {rich(t.step1Body(usd(bufferUsd)))}
          {harvestableUsd != null && harvestableUsd > 0 && rich(t.step1Harvestable(usd(harvestableUsd)))}
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={harvestAmt}
            onChange={(e) => setHarvestAmt(e.target.value)}
            inputMode="decimal"
            placeholder="USDC"
            className="w-28 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
          />
          {recHarvest && (
            <button type="button" onClick={() => setHarvestAmt(recHarvest)} className="text-[10px] text-accent hover:underline">
              {t.use(usd(Number(recHarvest)))}
            </button>
          )}
          <button
            type="button"
            onClick={() => run("harvest", () => proposeHarvest(harvestAmt))}
            disabled={pending || !harvestAmt}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            {busy("harvest") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sprout className="h-3.5 w-3.5" />}
            {t.harvest}
          </button>
        </div>
        {harvestableUsd != null && harvestableUsd <= 0 && (
          <p className="mt-1.5 text-[11px] text-foreground-faint">{t.nothingToHarvest}</p>
        )}
        <Feedback r={res.harvest ?? null} />
      </StepCard>

      {/* 2 — set the tap */}
      <StepCard n={2} title={t.step2}>
        <p className="mb-2 text-[11px] text-foreground-subtle">
          {t.step2Body}
          {sustainable != null ? rich(t.step2Recommended(usd(sustainable))) : t.step2NoRecommendation}
          {currentFlowMonthly > 0 && rich(t.step2Current(usd(currentFlowMonthly)))}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface-elevated focus-within:border-border-strong">
            <span className="pl-3 text-xs text-foreground-faint">$</span>
            <input
              value={flowAmt}
              onChange={(e) => setFlowAmt(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-20 bg-transparent px-1.5 py-2 text-sm tabular-nums text-foreground outline-none"
            />
            <span className="pr-3 text-xs text-foreground-faint">{dict.wallet.perMonth}</span>
          </div>
          {recFlow && (
            <button type="button" onClick={() => setFlowAmt(recFlow)} className="text-[10px] text-accent hover:underline">
              {t.useRecommended}
            </button>
          )}
          <button
            type="button"
            onClick={() => run("flow", () => proposeSetFlow(flowAmt))}
            disabled={pending || !flowAmt}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            {busy("flow") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Droplets className="h-3.5 w-3.5" />}
            {t.setFlow}
          </button>
        </div>
        {overSustainable && (
          <p className="mt-1.5 text-[11px] text-warning">
            {t.overSustainable(usd(flowNum), usd(sustainable!))}
          </p>
        )}
        <Feedback r={res.flow ?? null} />
      </StepCard>

      {/* 3 — auto-pilot */}
      <StepCard n={3} title={t.step3}>
        <p className="mb-2 text-[11px] text-foreground-subtle">
          {t.step3Body}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            inputMode="decimal"
            placeholder={t.allowancePlaceholder}
            className="w-32 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() => run("aw", () => proposeAutoWrap(allowance))}
            disabled={pending || !allowance}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {busy("aw") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {t.turnOnAutopilot}
          </button>
        </div>
        <Feedback r={res.aw ?? null} />
      </StepCard>

      {/* Advanced / rarely-needed */}
      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-foreground-faint hover:text-foreground"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${advanced ? "rotate-180" : ""}`} /> {t.advanced}
      </button>
      {advanced && (
        <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => run("units", proposeSetUnits)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
              >
                {busy("units") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {t.saveShares}
              </button>
              <span className="text-[11px] text-foreground-faint">{t.saveSharesHint}</span>
            </div>
            <Feedback r={res.units ?? null} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={wrapAmt}
                onChange={(e) => setWrapAmt(e.target.value)}
                inputMode="decimal"
                placeholder="USDC"
                className="w-28 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm tabular-nums text-foreground focus:border-border-strong focus:outline-none"
              />
              <button
                type="button"
                onClick={() => run("wrap", () => proposeWrap(wrapAmt))}
                disabled={pending || !wrapAmt}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
              >
                {busy("wrap") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Droplets className="h-3.5 w-3.5" />}
                {t.fillBuffer}
              </button>
              <span className="text-[11px] text-foreground-faint">{t.fillBufferHint}</span>
            </div>
            <Feedback r={res.wrap ?? null} />
          </div>
          <div>
            <button
              type="button"
              onClick={() => run("stop", () => proposeSetFlow("0"))}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {busy("stop") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              {t.stop}
            </button>
            <Feedback r={res.stop ?? null} />
          </div>
        </section>
      )}
    </div>
  );
}
