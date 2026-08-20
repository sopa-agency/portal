"use client";

import { useState, useTransition } from "react";
import { Waypoints, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { proposeCreatePool } from "@/app/actions/superfluid";
import { useT } from "@/components/locale-provider";

// Proposes creating the SOPA payroll distribution pool on the Safe. The proposer
// signs server-side; owners approve + execute in Safe{Wallet}. Shown only when
// no pool exists yet.
export function CreatePoolButton() {
  const t = useT().treasury.pool;
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = () =>
    start(async () => {
      setErr(null);
      const res = await proposeCreatePool();
      if (res.ok) setDone({ url: res.url });
      else setErr(res.error);
    });

  if (done) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/5 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" /> {t.proposedTitle}
        </h3>
        <p className="mt-1.5 text-xs text-foreground-muted">
          {t.proposedBody}
        </p>
        <a
          href={done.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-lime-400/30"
        >
          {t.openQueue} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Waypoints className="h-4 w-4 text-accent" /> {t.createTitle}
      </h3>
      <p className="mt-1.5 max-w-xl text-xs text-foreground-subtle">
        {t.createBody}
      </p>
      {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Waypoints className="h-3.5 w-3.5" />}
        {t.createAction}
      </button>
    </div>
  );
}
