"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measured pixel width of the chart's container.
 *
 * Charts here are drawn in real pixels rather than a scaled viewBox: a viewBox
 * that stretches also stretches the type and the stroke widths, so labels end
 * up at a different size in every card. Measuring once and laying out in px
 * keeps 2px lines 2px and 11px labels 11px at any container width.
 */
export function useChartWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Set the first measurement synchronously-ish: the observer fires on
    // observe(), so there is no frame where the chart renders at width 0.
    if (typeof ResizeObserver === "undefined") {
      setWidth(node.clientWidth);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
