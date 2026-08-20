"use client";

import { useId } from "react";

/**
 * Circular flag marks for the language switch.
 *
 * Drawn as inline SVG rather than emoji (🇺🇸/🇧🇷) because Windows ships no flag
 * glyphs at all — the emoji degrades to the letters "US" and "BR", which is
 * exactly the thing this button is supposed to stop being.
 *
 * Both flags are in the DOM at once for the flip, so the clip paths need ids
 * that cannot collide — hence useId rather than a constant.
 *
 * Simplified for ~20px: the US canton gets a readable star field instead of
 * fifty unreadable ones, and Brazil's banner is a plain arc without the motto.
 */

type FlagProps = { className?: string };

export function FlagUS({ className = "" }: FlagProps) {
  const id = useId();
  const clip = `us-${id}`;
  // 13 stripes over a 24-unit circle.
  const stripe = 24 / 13;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <clipPath id={clip}>
        <circle cx="12" cy="12" r="12" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width="24" height="24" fill="#F7F7F7" />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} y={i * stripe} width="24" height={stripe} fill="#C8102E" />
        ))}
        <rect width="10.2" height={stripe * 7} fill="#0A3161" />
        {/* Star field: five columns by four rows, offset every other row. */}
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3, 4].map((col) => (
            <circle
              key={`${row}-${col}`}
              cx={1.1 + col * 2 + (row % 2 ? 1 : 0)}
              cy={1.5 + row * 3.1}
              r="0.62"
              fill="#F7F7F7"
            />
          )),
        )}
      </g>
    </svg>
  );
}

export function FlagBR({ className = "" }: FlagProps) {
  const id = useId();
  const clip = `br-${id}`;
  const globe = `br-globe-${id}`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <clipPath id={clip}>
        <circle cx="12" cy="12" r="12" />
      </clipPath>
      <clipPath id={globe}>
        <circle cx="12" cy="12" r="4.9" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width="24" height="24" fill="#009B3A" />
        <polygon points="12,2.6 22.2,12 12,21.4 1.8,12" fill="#FFDF00" />
        <circle cx="12" cy="12" r="4.9" fill="#002776" />
        {/* The banner dips in the middle — concave up, which is what lets the
            motto read left-to-right on the real flag. Clipped to the globe so
            both ends finish flush against its edge. */}
        <path
          d="M6.2 8.6 C 9.4 13.4 14.6 13.4 17.8 8.6 L 17.8 10.2 C 14.6 15.0 9.4 15.0 6.2 10.2 Z"
          fill="#F7F7F7"
          clipPath={`url(#${globe})`}
        />
        {[
          [12, 9.0],
          [10.0, 9.9],
          [14.1, 10.0],
          [11.1, 11.2],
          [13.1, 11.3],
          [8.7, 9.2],
          [15.4, 9.3],
          [12, 15.3],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.4" fill="#F7F7F7" clipPath={`url(#${globe})`} />
        ))}
      </g>
    </svg>
  );
}
