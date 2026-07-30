import { type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

// The page-wide contract for "did we actually observe this number?". It exists to
// end the split personality the treasury page had: the vault card refused to show
// unobserved numbers ("prefiro não mostrar número nenhum a mostrar um errado"),
// while page-level `.catch(() => 0)` silently turned failed reads into a real-
// looking $0. Four states, so a failed read is NEVER indistinguishable from zero:
//
//   loading        — client-side fetch in flight
//   not-configured — nothing set up yet (no pool, no vault, no bounty Safe)
//   error          — a read was attempted and failed
//   ok             — observed value; `data` MAY be 0 and renders normally
export type DataState<T> =
  | { status: "loading" }
  | { status: "not-configured"; reason?: string }
  | { status: "error"; message?: string }
  | { status: "ok"; data: T };

export const ok = <T,>(data: T): DataState<T> => ({ status: "ok", data });
export const notConfigured = (reason?: string): DataState<never> => ({ status: "not-configured", reason });
export const failed = (message?: string): DataState<never> => ({ status: "error", message });

/** Calm, dashed "not set up yet" placeholder — never alarming, never a number. */
export function NotConfigured({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-xs leading-relaxed text-foreground-faint">
      {children}
    </div>
  );
}

/** The honest guard, generalized: a read failed, so we show copy, not a wrong
    number. Mirrors the vault card's original wording so the whole page speaks
    with one voice. */
export function ReadFailed({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {children ??
          "Não consegui ler esse dado agora (a rede pública engasgou). Recarregue em instantes — prefiro não mostrar número nenhum a mostrar um errado."}
      </span>
    </div>
  );
}

/** Inline spinner for a client-fetched value that hasn't landed yet. */
export function LoadingDots() {
  return <Loader2 className="inline h-3.5 w-3.5 animate-spin text-foreground-faint" aria-label="carregando" />;
}
