// Strip characters Postgres/Prisma can't serialize. Gathered content (commit
// messages, social copy, brand docs) can carry lone UTF-16 surrogates (half of
// an emoji split by an upstream truncation), null bytes, or other C0 control
// chars — any of which make Prisma's query engine fail with
// "unexpected end of hex escape". Preserves valid surrogate PAIRS + \t \n \r.
//
// Lives here (not in a "use server" action file) because it's a pure sync util,
// and every export of a "use server" module must be an async function.
export function sanitizeForDb(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // C0 control chars, except tab (0x09) / LF (0x0A) / CR (0x0D)
    if (c <= 0x1f && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    // High surrogate: keep only if it forms a valid pair with the next unit.
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
        continue;
      }
      continue; // lone high surrogate
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue; // lone low surrogate
    out += text[i];
  }
  return out;
}
