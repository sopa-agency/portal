import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { CHALLENGE_COOKIE, CHALLENGE_MAX_AGE, signChallenge } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const nonce = `portal-skatehive:${crypto.randomBytes(16).toString("hex")}:${Date.now()}`;
  const token = await signChallenge(nonce);
  const res = NextResponse.json({ nonce });
  res.cookies.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CHALLENGE_MAX_AGE,
  });
  return res;
}
