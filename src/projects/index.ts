import { headers } from "next/headers";
import type { ProjectConfig } from "./types";
import skatehive from "./skatehive";
import gnars from "./gnars";
import reelflip from "./reelflip";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PROJECT_REGISTRY: Record<string, ProjectConfig> = {
  skatehive,
  gnars,
  reelflip,
};

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

/**
 * Extract the leftmost subdomain from a Host header value and map it to a
 * known project slug.
 *
 * Examples:
 *   "skatehive.portal.app"     -> "skatehive"
 *   "gnars.portal.app"         -> "gnars"
 *   "skatehive.localhost:3010" -> "skatehive"
 *   "localhost:3010"           -> process.env.PORTAL_DEFAULT_PROJECT ?? "skatehive"
 *   "portal.app"               -> process.env.PORTAL_DEFAULT_PROJECT ?? "skatehive"
 *   null                       -> process.env.PORTAL_DEFAULT_PROJECT ?? "skatehive"
 */
export function resolveProjectSlug(host: string | null): string {
  const defaultSlug = process.env.PORTAL_DEFAULT_PROJECT ?? "skatehive";
  if (!host) return defaultSlug;

  // Strip port if present (e.g. "skatehive.localhost:3010" -> "skatehive.localhost")
  const hostWithoutPort = host.split(":")[0];
  const parts = hostWithoutPort.split(".");

  // Need at least two parts and the leftmost must not be a bare apex
  // ("portal.app" has two parts but no meaningful subdomain).
  if (parts.length < 2) return defaultSlug;

  const candidate = parts[0].toLowerCase();

  // Bare localhost or single-label hosts get the default.
  if (candidate === "localhost" || candidate === "127" || candidate === "") return defaultSlug;

  // If the candidate matches a registered slug, use it.
  if (candidate in PROJECT_REGISTRY) return candidate;

  // Unknown subdomain — fall back to default so unknown subdomains don't 404.
  return defaultSlug;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve a ProjectConfig by slug, falling back to the default project if
 * the slug is not registered.
 */
export function getProject(slug: string): ProjectConfig {
  return PROJECT_REGISTRY[slug] ?? PROJECT_REGISTRY[process.env.PORTAL_DEFAULT_PROJECT ?? "skatehive"] ?? skatehive;
}

/** All registered projects (for the portal switcher). */
export function getAllProjects(): ProjectConfig[] {
  return Object.values(PROJECT_REGISTRY);
}

/**
 * Read the active project for the current request.
 *
 * The middleware stamps every request with an `x-portal-project` header
 * containing the resolved slug. This function reads that header (via
 * next/headers) and returns the matching ProjectConfig. Works in server
 * components, server actions, and route handlers.
 */
export async function getActiveProject(): Promise<ProjectConfig> {
  const headersList = await headers();
  const slug = headersList.get("x-portal-project") ?? (process.env.PORTAL_DEFAULT_PROJECT ?? "skatehive");
  return getProject(slug);
}

// Re-export types and individual project configs for convenience.
export type { ProjectConfig } from "./types";
export { skatehive, gnars, reelflip };
