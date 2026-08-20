import { NextRequest, NextResponse } from "next/server";
import { Client, PublicKey, Signature, cryptoUtils } from "@hiveio/dhive";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  cookieDomainFor,
  SESSION_MAX_AGE,
  signSession,
  verifyChallenge,
} from "@/lib/auth";
import { getAccess } from "@/lib/team-access";
import { prisma } from "@/lib/prisma";
import { resolveHasAvatar } from "@/lib/team-roster";
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

  // DB-backed authorization (falls back to the static allowlist for unseeded
  // projects) — so members added via the admin UI can sign in.
  const access = await getAccess(username, project);
  if (!access.allowed) {
    return NextResponse.json(
      { error: `@${username} não tem acesso ao portal ${project.name}. Peça a um admin para te adicionar.` },
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

  // Record login activity (last seen + count) — best-effort, never blocks login.
  try {
    const now = new Date();
    // Resolved here, at the one moment we can afford an external call, so the
    // root layout never pays for it on every page render.
    const hasAvatar = await resolveHasAvatar(username).catch(() => null);
    await prisma.memberActivity.upsert({
      where: { username },
      update: {
        lastLoginAt: now,
        lastLoginProject: project.slug,
        loginCount: { increment: 1 },
        ...(hasAvatar === null ? {} : { hasAvatar }),
      },
      create: {
        username,
        lastLoginAt: now,
        lastLoginProject: project.slug,
        loginCount: 1,
        ...(hasAvatar === null ? {} : { hasAvatar }),
      },
    });
  } catch {
    /* tracking is non-critical */
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
    ...((d) => (d ? { domain: d } : {}))(cookieDomainFor(req.headers.get("host"))),
  });
  // Clear the one-time challenge cookie
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
