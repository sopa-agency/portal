import type { ReactNode } from "react";

/**
 * Minimal inline markdown for dictionary strings: `**bold**` and `*italic*`.
 *
 * Copy that needs emphasis mid-sentence used to be chopped into three keys
 * (before / bold word / after), which reads terribly in the dictionary and
 * translates worse — the emphasis rarely falls on the same word in another
 * language. Keeping the marks inside the string lets each locale put them
 * where its own sentence wants them.
 *
 * No block syntax, no links: this is emphasis inside one line, nothing more.
 */
export function rich(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong key={i} className="text-foreground">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}
