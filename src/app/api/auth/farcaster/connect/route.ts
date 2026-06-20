import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Persists a Farcaster signer that a portal admin approved via Sign In With
// Neynar (the Settings → "Conectar Farcaster" button). The browser passes the
// signer_uuid + fid the SIWN widget returned; we re-verify it server-side with
// the project's Neynar API key before trusting it, so a forged POST can't set
// the brand's signer.
export async function POST(req: NextRequest) {
  const project = await getActiveProject();

  // Only an authorized admin of THIS portal may connect its Farcaster.
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (who.role !== "admin") {
    return NextResponse.json({ error: "Apenas admins podem conectar o Farcaster." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { signer_uuid?: string; fid?: number } | null;
  const signerUuid = body?.signer_uuid?.trim();
  if (!signerUuid) return NextResponse.json({ error: "signer_uuid ausente." }, { status: 400 });

  // The signer was created under THIS project's Neynar app, so verify with its
  // own key (signer is invalid under another app's key).
  const prefix = project.agent.gatewayEnvPrefix;
  const apiKey = (prefix && process.env[`${prefix}_NEYNAR_API_KEY`]) || process.env.NEYNAR_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "NEYNAR_API_KEY não configurada." }, { status: 500 });

  // Verify the signer is real + approved under our app.
  let fid: number | null = body?.fid ?? null;
  try {
    const res = await fetch(
      `https://api.neynar.com/v2/farcaster/signer?signer_uuid=${encodeURIComponent(signerUuid)}`,
      { headers: { "x-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: `Neynar não validou o signer (HTTP ${res.status}). ${t.slice(0, 160)}` }, { status: 400 });
    }
    const j = (await res.json()) as { status?: string; fid?: number };
    if (j.status !== "approved") {
      return NextResponse.json({ error: `Signer ainda não aprovado (status: ${j.status ?? "desconhecido"}). Aprove no Warpcast e tente de novo.` }, { status: 400 });
    }
    if (typeof j.fid === "number") fid = j.fid;
  } catch {
    return NextResponse.json({ error: "Não foi possível falar com a Neynar (timeout)." }, { status: 502 });
  }

  // Resolve the Farcaster handle for display (best-effort, reading uses the same key).
  let username: string | null = null;
  if (fid) {
    try {
      const res = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
        headers: { "x-api-key": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const j = (await res.json()) as { users?: { username?: string }[] };
        username = j.users?.[0]?.username ?? null;
      }
    } catch {
      /* non-critical */
    }
  }

  await prisma.farcasterSigner.upsert({
    where: { projectSlug: project.slug },
    update: { signerUuid, fid, username, status: "approved", connectedBy: who.username },
    create: { projectSlug: project.slug, signerUuid, fid, username, status: "approved", connectedBy: who.username },
  });

  return NextResponse.json({ ok: true, username, fid });
}

// Disconnect — flips status to revoked so publishing falls back to env (or off).
export async function DELETE() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who || who.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  await prisma.farcasterSigner
    .update({ where: { projectSlug: project.slug }, data: { status: "revoked", connectedBy: who.username } })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
