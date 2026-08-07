/** Formatters shared by the analytics charts. Lives here rather than inside a
 *  panel so one panel never has to import from another just to borrow a
 *  helper — the Search Console panel was reaching into the GA4 one for this. */

/** "7 de ago." / "Aug 7" for a chart's x axis — short, no year.
 *
 *  Two formats reach this: GA4's `date` dimension gives yyyymmdd, Search
 *  Console's gives yyyy-mm-dd. Both are built from their parts rather than
 *  handed to `new Date(string)`, which reads them as UTC midnight and lands on
 *  the day before for anyone west of Greenwich. */
export function shortDate(iso: string, locale: string): string {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", {
    day: "numeric",
    month: "short",
  });
}
