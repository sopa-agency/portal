"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Clock, XCircle, X } from "lucide-react";
import { getBriefingJobs, type BriefingJobStatus } from "@/app/actions/briefings";

type Job = { agent: string; jobId: string };

// What the agent does while "running" — cycled as a caption to convey
// progress + set the ~1-2 min expectation (the actual run is opaque).
const RUNNING_STEPS = [
  "Reading live social numbers…",
  "Checking the GitHub board…",
  "Reviewing recent activity & docs…",
  "Writing the briefing…",
];

function prettyAgent(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function BriefingRegenDialog({
  jobs,
  onClose,
}: {
  jobs: Job[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, BriefingJobStatus["status"]>>(
    Object.fromEntries(jobs.map((j) => [j.jobId, "queued" as const])),
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [elapsed, setElapsed] = useState(0);
  const [step, setStep] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const startRef = useRef(Date.now());

  // Elapsed timer + rotating running caption.
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    const s = setInterval(() => setStep((i) => (i + 1) % RUNNING_STEPS.length), 3000);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, []);

  // Poll job statuses until all settle.
  useEffect(() => {
    const ids = jobs.map((j) => j.jobId);
    if (ids.length === 0) {
      setAllDone(true);
      return;
    }
    let stop = false;
    const deadline = Date.now() + 8 * 60_000;
    const tick = async () => {
      if (stop) return;
      try {
        const rows = await getBriefingJobs(ids);
        const sMap: Record<string, BriefingJobStatus["status"]> = {};
        const eMap: Record<string, string | null> = {};
        for (const r of rows) {
          sMap[r.id] = r.status;
          eMap[r.id] = r.error;
        }
        setStatuses((prev) => ({ ...prev, ...sMap }));
        setErrors((prev) => ({ ...prev, ...eMap }));
        const settled = rows.length === ids.length && rows.every((r) => r.status === "done" || r.status === "error");
        if (settled) {
          setAllDone(true);
          router.refresh();
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      if (Date.now() < deadline) setTimeout(tick, 2500);
      else setAllDone(true);
    };
    const id = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = jobs.filter((j) => statuses[j.jobId] === "done").length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generating briefings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={allDone ? onClose : undefined}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {allDone ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            )}
            {allDone ? "Briefings updated" : "Generating briefings…"}
          </h3>
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs tabular-nums text-foreground-faint">
              {fmtElapsed(elapsed)}
            </span>
            {allDone && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg border border-border p-1 text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
        </div>

        {!allDone && (
          <p className="mt-1 text-[11px] text-foreground-subtle">
            Generated on the Mac mini — agents read analytics, the GitHub board and recent activity.
            Usually ~1–2 min each; you can close this and come back.
          </p>
        )}

        <div className="mt-4 space-y-2">
          {jobs.map((j) => {
            const st = statuses[j.jobId] ?? "queued";
            const err = errors[j.jobId];
            return (
              <div key={j.jobId} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                <span className="shrink-0">
                  {st === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : st === "error" ? (
                    <XCircle className="h-4 w-4 text-danger" />
                  ) : st === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  ) : (
                    <Clock className="h-4 w-4 text-foreground-faint" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{prettyAgent(j.agent)}</p>
                  <p className="truncate text-[10px] text-foreground-faint">
                    {st === "done"
                      ? "Done"
                      : st === "error"
                        ? err ?? "Failed"
                        : st === "running"
                          ? RUNNING_STEPS[step]
                          : "Queued…"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {allDone && (
          <p className="mt-3 text-center text-xs text-foreground-muted">
            {doneCount}/{jobs.length} regenerated.
          </p>
        )}
      </div>
    </div>
  );
}
