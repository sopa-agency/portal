import type { ProjectConfig } from "./types";

/**
 * Read a namespaced environment variable for a project.
 *
 * Convention: `${project.agent.gatewayEnvPrefix}_${key}`
 * e.g. projectEnv(skatehive, "GATEWAY_URL") -> process.env.SKATEHIVE_GATEWAY_URL
 *
 * For the SkateHive project (prefix "SKATEHIVE") we also check legacy global
 * variable names so the existing .env.local keeps working with zero changes:
 *
 *   SKATEHIVE_GATEWAY_URL  -> fallback: OPENCLAW_GATEWAY_URL
 *   SKATEHIVE_GATEWAY_TOKEN -> fallback: GATEWAY_TOKEN
 *   SKATEHIVE_PORTAL_DEVICE_ID -> fallback: OPENCLAW_PORTAL_DEVICE_ID
 *   SKATEHIVE_PORTAL_DEVICE_PUBLIC_KEY -> fallback: OPENCLAW_PORTAL_DEVICE_PUBLIC_KEY
 *   SKATEHIVE_PORTAL_DEVICE_PRIVATE_KEY_BASE64 -> fallback: OPENCLAW_PORTAL_DEVICE_PRIVATE_KEY_BASE64
 */
export function projectEnv(project: ProjectConfig, key: string): string | undefined {
  const namespacedKey = `${project.agent.gatewayEnvPrefix}_${key}`;
  const namespacedVal = process.env[namespacedKey]?.trim();
  if (namespacedVal) return namespacedVal;

  // Legacy fallbacks for SkateHive so existing .env.local needs no changes.
  if (project.agent.gatewayEnvPrefix === "SKATEHIVE") {
    const legacyMap: Record<string, string> = {
      GATEWAY_URL: "OPENCLAW_GATEWAY_URL",
      GATEWAY_TOKEN: "GATEWAY_TOKEN",
      PORTAL_DEVICE_ID: "OPENCLAW_PORTAL_DEVICE_ID",
      PORTAL_DEVICE_PUBLIC_KEY: "OPENCLAW_PORTAL_DEVICE_PUBLIC_KEY",
      PORTAL_DEVICE_PRIVATE_KEY_BASE64: "OPENCLAW_PORTAL_DEVICE_PRIVATE_KEY_BASE64",
    };
    const legacyName = legacyMap[key];
    if (legacyName) {
      const legacyVal = process.env[legacyName]?.trim();
      if (legacyVal) return legacyVal;
    }
  }

  return undefined;
}
