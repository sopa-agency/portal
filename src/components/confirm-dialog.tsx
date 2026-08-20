"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useDialogA11y } from "@/hooks/use-dialog-a11y";
import { useT } from "@/components/locale-provider";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). Default true. */
  danger?: boolean;
};

/**
 * Promise-based, on-design-system replacement for `window.confirm` — matches the
 * repo's hand-rolled modal pattern and is fully keyboard-accessible via
 * useDialogA11y. Self-contained (no provider): call the hook, render `confirmUI`,
 * and `await confirm({...})` at the call site.
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(options);
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }, []);

  const confirmUI = opts ? <ConfirmDialog opts={opts} onResolve={settle} /> : null;
  return { confirm, confirmUI };
}

function ConfirmDialog({ opts, onResolve }: { opts: ConfirmOptions; onResolve: (value: boolean) => void }) {
  const tt = useT().ui.confirm;
  const panelRef = useRef<HTMLDivElement>(null);
  const danger = opts.danger ?? true;
  useDialogA11y(panelRef, () => onResolve(false));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => onResolve(false)}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-label={opts.title}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {danger && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
              <AlertTriangle className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">{opts.title}</h2>
            {opts.message && <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{opts.message}</p>}
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {opts.cancelLabel ?? tt.cancel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              danger
                ? "bg-danger text-white hover:bg-danger/90"
                : "bg-accent text-accent-foreground hover:bg-accent/90"
            }`}
          >
            {opts.confirmLabel ?? tt.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
