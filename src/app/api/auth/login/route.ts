import { NextRequest, NextResponse } from "next/server";
import { Client, PublicKey, Signature, cryptoUtils } from "@hiveio/dhive";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  SESSION_COOKIE_DOMAIN,
  SESSION_MAX_AGE,
  isAllowed,
  signSession,
  verifyChallenge,
} from "@/lib/auth";
import { getActiveProject } from "@/projects/index";

export const runtime = "nodejs";

const HIVE_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu",
];

type Body = { username?: unknown; signature?: unknown };

export async function POST(req: NextRequest) {
  const project = await getActiveProject();

  const body = (await req.json().catch(() => null)) as Body | null;
  const username = typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";
  const signatureHex = typeof body?.signature === "string" ? body.signature : "";

  if (!username || !signatureHex) {
    return NextResponse.json({ error: "username and signature required" }, { status: 400 });
  }

  if (!isAllowed(username, project)) {
    return NextResponse.json(
      { error: `@${username} is not on the ${project.name} portal allowlist. Ask an admin to add you.` },
      { status: 403 },
    );
  }

  const challengeToken = req.cookies.get(CHALLENGE_COOKIE)?.value;
  const nonce = await verifyChallenge(challengeToken);
  if (!nonce) {
    return NextResponse.json(
      { error: "Challenge expired or missing. Refresh the page and try again." },
      { status: 400 },
    );
  }

  // Look up posting public keys from Hive
  const client = new Client(HIVE_NODES);
  const [account] = await client.database.getAccounts([username]);
  if (!account) {
    return NextResponse.json({ error: `@${username} not found on Hive` }, { status: 404 });
  }
  const postingKeys: string[] = (account.posting?.key_auths ?? []).map(([key]) =>
    typeof key === "string" ? key : key.toString(),
  );

  // Verify the signature: recover the public key from the signed hash,
  // confirm it matches one of the account's posting key_auths.
  let sig: Signature;
  try {
    sig = Signature.fromString(signatureHex);
  } catch {
    return NextResponse.json({ error: "Malformed signature" }, { status: 400 });
  }
  const hash = cryptoUtils.sha256(Buffer.from(nonce, "utf8"));
  let recovered: PublicKey;
  try {
    recovered = sig.recover(hash);
  } catch {
    return NextResponse.json({ error: "Signature could not be recovered" }, { status: 400 });
  }
  const recoveredStr = recovered.toString();
  if (!postingKeys.includes(recoveredStr)) {
    return NextResponse.json(
      {
        error:
          "Signature doesn't match @" +
          username +
          "'s posting key. Make sure Keychain is unlocked and signed with the posting key.",
      },
      { status: 401 },
    );
  }

  // Issue session
  const token = await signSession({ username });
  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
  });
  // Clear the one-time challenge cookie
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
