import { SignJWT, jwtVerify } from "jose";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Legacy SkateHive allowlist — kept for backward compatibility.
// New code should call isAllowed(username, project) with an active project.
// ---------------------------------------------------------------------------
export const ALLOWED_USERS = [
  "xvlad",
  "howdarylrolls",
  "skatehive",
  "skatedev",
  "skatehacker",
  "mengao",
  "louzoshi",
  "knowhow92",
  "web-gnar",
  "vaipraonde",
  "nogenta",
  "humbertoperes",
] as const;

export type AllowedUser = (typeof ALLOWED_USERS)[number];

// ---------------------------------------------------------------------------
// Global allowlist — users allowed into EVERY portal regardless of a project's
// own allowlist (cross-portal admins / operators).
// ---------------------------------------------------------------------------
export const GLOBAL_ALLOWLIST: readonly string[] = ["beaglexv"];

// ---------------------------------------------------------------------------
// Cookie names — unified across all tenants now that it's one app.
// ---------------------------------------------------------------------------
export const SESSION_COOKIE = "portal_session";
export const CHALLENGE_COOKIE = "portal_challenge";

// Optional cookie domain so ONE login is shared across all tenant subdomains.
// Set to ".portal.skatehive.app" in PRODUCTION only — then the session cookie
// is valid on every *.portal.skatehive.app portal (Notion-style unified login).
// Leave UNSET on preview (*.vercel.app) and local (localhost/nip.io), where that
// domain wouldn't match the host and the cookie would be rejected.
export const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined;

// Legacy aliases kept so any stale imports still compile.
/** @deprecated Use SESSION_COOKIE */
export const SKATEHIVE_SESSION_COOKIE = "portal_session";
/** @deprecated Use CHALLENGE_COOKIE */
export const SKATEHIVE_CHALLENGE_COOKIE = "portal_challenge";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
const CHALLENGE_DURATION_SECONDS = 60 * 5; // 5 minutes

// ---------------------------------------------------------------------------
// isAllowed
// ---------------------------------------------------------------------------

/**
 * Project-aware allowlist check.
 *
 * When a ProjectConfig is supplied the username is checked against
 * project.allowlist. When called without a project (legacy / boot-time path)
 * it falls back to the hardcoded SkateHive ALLOWED_USERS.
 */
export function isAllowed(username: string, project?: ProjectConfig): boolean {
  const u = username.toLowerCase();
  if (GLOBAL_ALLOWLIST.includes(u)) return true; // cross-portal admins
  const list = project ? project.allowlist : (ALLOWED_USERS as readonly string[]);
  return list.includes(u);
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET not set");
  return new TextEncoder().encode(raw);
}

export type SessionPayload = { username: string };

export async function signSession(payload: SessionPayload): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS)
    .sign(secret());
}

/**
 * Verify a session JWT and validate the username against the given project's
 * allowlist. Pass `project` from the active request's getActiveProject() call.
 * Omitting `project` falls back to the SkateHive hardcoded list (legacy path).
 */
export async function verifySession(
  token: string | undefined,
  project?: ProjectConfig,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.username !== "string") return null;
    if (!isAllowed(payload.username, project)) return null;
    return { username: payload.username };
  } catch {
    return null;
  }
}

export type ChallengePayload = { nonce: string; iat: number };

export async function signChallenge(nonce: string): Promise<string> {
  return await new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + CHALLENGE_DURATION_SECONDS)
    .sign(secret());
}

export async function verifyChallenge(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = SESSION_DURATION_SECONDS;
export const CHALLENGE_MAX_AGE = CHALLENGE_DURATION_SECONDS;
