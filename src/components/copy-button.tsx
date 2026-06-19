"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Copy-to-clipboard control with transient "copied" feedback (icon swaps to a
 * check for ~1.5s). Renders a leading copy/check icon followed by `children`.
 */
export function CopyButton({
  value,
  className,
  title = "Copiar",
  children,
}: {
  value: string;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }
  return (
    <button type="button" onClick={copy} title={done ? "Copiado!" : title} aria-label={title} className={className}>
      {done ? <Check className="h-3 w-3 shrink-0 text-success" /> : <Copy className="h-3 w-3 shrink-0" />}
      {children}
    </button>
  );
}
