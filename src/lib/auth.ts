import { SignJWT, jwtVerify } from "jose";

// Allowlist of Hive usernames permitted to use portal-skatehive.
// To add/remove access, edit this array. No DB write needed.
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

export const SESSION_COOKIE = "portal_session";
export const CHALLENGE_COOKIE = "portal_challenge";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
const CHALLENGE_DURATION_SECONDS = 60 * 5; // 5 minutes

export function isAllowed(username: string): username is AllowedUser {
  return (ALLOWED_USERS as readonly string[]).includes(username.toLowerCase());
}

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

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.username !== "string") return null;
    if (!isAllowed(payload.username)) return null;
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
