import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Brand-scoped credential resolution.
//
// The bare/global env vars (HIVE_POSTING_KEY, NEYNAR_SIGNER_UUID,
// INSTAGRAM_ACCESS_TOKEN, BINANCE_SQUARE_OPENAPI_KEY, DISCORD_BOT_TOKEN…)
// predate multi-tenancy and belong to SKATEHIVE. Falling back to them from
// another portal would post AS SKATEHIVE from a different brand — so for
// identity-bearing credentials the global is honored ONLY by its owner.
// Shared, non-identity keys (NEYNAR_API_KEY, PINATA_JWT…) keep their normal
// global fallback and must NOT use this helper.
// ---------------------------------------------------------------------------

/** Owner of the legacy bare env vars. */
const GLOBAL_OWNER_PREFIX = "SKATEHIVE";

/**
 * Resolve an identity-bearing credential for a project.
 * `globalKey` defaults to the suffix itself; pass it when the bare var has a
 * different name (e.g. suffix BINANCE_SQUARE_KEY, global BINANCE_SQUARE_OPENAPI_KEY).
 */
export function brandEnvByPrefix(
  prefix: string | undefined,
  suffix: string,
  globalKey: string = suffix,
): string | undefined {
  const own = prefix ? process.env[`${prefix}_${suffix}`]?.trim() : undefined;
  if (own) return own;
  const global = process.env[globalKey]?.trim();
  if (global && (!prefix || prefix === GLOBAL_OWNER_PREFIX)) return global;
  return undefined;
}

export function brandEnv(
  project: ProjectConfig | undefined,
  suffix: string,
  globalKey: string = suffix,
): string | undefined {
  return brandEnvByPrefix(project?.agent?.gatewayEnvPrefix, suffix, globalKey);
}

/** True when the project resolves this credential (own key, or it owns the global). */
export function hasBrandEnv(
  project: ProjectConfig | undefined,
  suffix: string,
  globalKey: string = suffix,
): boolean {
  return !!brandEnv(project, suffix, globalKey);
}
