/**
 * An on-chain (or off-chain) read has THREE states, never two.
 *
 * A failed read never silently becomes zero. On a yield panel, a false zero is
 * worse than a visible error.
 *
 * ── Why this is a type and not a convention ──────────────────────────────────
 * The sister project fought this battle in prose: ~48 comments across its
 * services warn about degradation, and a handful of `?? 0n` fallbacks still
 * survive. Its own words, from production:
 *
 *   "allowFailure lets a genuinely empty vault (success, 0n) and a dead RPC
 *    (failure, no result) both arrive here. Coercing the second to 0n is what
 *    turns an outage into a plausible 'nobody has staked' graph — the exact
 *    shape of bug that gets cached and believed."
 *
 * There, degradation is one boolean for a whole page, and the only way to keep
 * a degraded result out of the cache was to throw a custom error carrying the
 * partial payload. Here degradation is per value, and a bad read simply never
 * becomes a value — so there is nothing to keep out of anything.
 */
export type Reading<T> =
  | {
      state: "ok";
      value: T;
      /** epoch ms of the read. Absent for fixtures. */
      asOf?: number;
    }
  /** Read fine, but there is not enough history to compute yet. Not a zero. */
  | { state: "insufficient"; note: string }
  /** Could not read / could not validate. Not a zero. */
  | {
      state: "unread";
      reason: string;
      /**
       * The last value that DID read, if we have one. Shown as history, never
       * as the current number — the UI still renders the failure plate. This
       * is what the sister project had to throw an exception to preserve.
       */
      lastGood?: { value: T; asOf: number };
    };

export const ok = <T>(value: T, asOf?: number): Reading<T> => ({ state: "ok", value, asOf });
export const insufficient = <T>(note: string): Reading<T> => ({ state: "insufficient", note });
export const unread = <T>(reason: string, lastGood?: { value: T; asOf: number }): Reading<T> =>
  ({ state: "unread", reason, lastGood });

export const isOk = <T>(r: Reading<T>): r is { state: "ok"; value: T; asOf?: number } =>
  r.state === "ok";

/**
 * Run a read that may throw and get a Reading back. Never throws, never
 * returns a zero of its own invention.
 *
 * `previous` carries a last-known-good forward onto the failure, so an outage
 * shows "could not read" WITH context instead of erasing what we knew.
 */
export async function attempt<T>(
  fn: () => Promise<T>,
  onFail: (e: unknown) => string,
  previous?: Reading<T>,
): Promise<Reading<T>> {
  try {
    return ok(await fn(), Date.now());
  } catch (e) {
    const lastGood =
      previous && previous.state === "ok" && previous.asOf !== undefined
        ? { value: previous.value, asOf: previous.asOf }
        : previous && previous.state === "unread"
          ? previous.lastGood
          : undefined;
    return unread(onFail(e), lastGood);
  }
}

/**
 * The single most important adapter in this file.
 *
 * viem's `multicall({ allowFailure: true })` returns success and failure in the
 * same array shape, and the natural next line is `result ?? 0n`. That line is
 * the bug. This function makes it unwritable: a failed call cannot produce a
 * value, only a reason.
 */
export function fromCall<T>(
  call: { status: "success"; result: unknown } | { status: "failure"; error?: unknown },
  map: (raw: never) => T,
  reason: string,
  previous?: Reading<T>,
): Reading<T> {
  if (call.status === "failure") {
    const lastGood =
      previous && previous.state === "ok" && previous.asOf !== undefined
        ? { value: previous.value, asOf: previous.asOf }
        : undefined;
    return unread(reason, lastGood);
  }
  try {
    return ok(map(call.result as never), Date.now());
  } catch {
    return unread(`${reason} — unexpected shape`);
  }
}

/**
 * Summing readings is only honest when ALL of them are "ok". A bad read
 * contaminates the total — it is not worth zero in the arithmetic.
 */
export function sumReadings(rs: Reading<number>[]): Reading<number> {
  const bad = rs.find((r) => r.state !== "ok");
  if (bad) {
    return bad.state === "unread"
      ? unread(`total incomplete — ${bad.reason}`)
      : insufficient(`total incomplete — ${bad.note}`);
  }
  return ok(rs.reduce((a, r) => a + (r as { value: number }).value, 0));
}

/**
 * What a read has answered by now — without waiting for it.
 *
 * For a read that was STARTED early and is consumed late: by the time the
 * caller gets here, the read has had the whole page's worth of seconds to
 * land. If it landed, use it. If the upstream is hanging, the caller must not
 * hang with it — a treasury page once waited 19s on one diagram nobody was
 * looking at. Past `ms` the answer is an honest `unread`, never a zero, and the
 * original promise keeps going for whoever CAN wait (a Suspense boundary).
 */
export function settledWithin<T>(p: Promise<Reading<T>>, ms: number, reason: string): Promise<Reading<T>> {
  return Promise.race([p, new Promise<Reading<T>>((resolve) => setTimeout(() => resolve(unread(reason)), ms))]);
}

/** How many of these readings actually read. Used for read-health summaries. */
export function readHealth(rs: Reading<unknown>[]) {
  return {
    total: rs.length,
    ok: rs.filter((r) => r.state === "ok").length,
    waiting: rs.filter((r) => r.state === "insufficient").length,
    failed: rs.filter((r) => r.state === "unread").length,
  };
}
