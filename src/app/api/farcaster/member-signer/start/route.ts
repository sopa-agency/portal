import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { mintMemberSigner, sponsorConfigured } from "@/lib/farcaster-sponsor";

export const runtime = "nodejs";

// Mint a per-member managed signer + approval QR. The logged-in member scans
// the QR and approves in their own Warpcast; /status then captures it.
export async function POST() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!sponsorConfigured()) {
    return NextResponse.json({ error: "Sponsor de Farcaster não configurado neste ambiente." }, { status: 503 });
  }

  const minted = await mintMemberSigner();
  if (!minted.ok) return NextResponse.json({ error: minted.error }, { status: 502 });

  // Record as pending for this member (one connection per member).
  await prisma.farcasterMemberSigner
    .upsert({
      where: { username: who.username },
      update: { signerUuid: minted.data.signerUuid, status: "pending", fid: null, handle: null },
      create: { username: who.username, signerUuid: minted.data.signerUuid, status: "pending" },
    })
    .catch(() => {});

  return NextResponse.json({
    ok: true,
    signer_uuid: minted.data.signerUuid,
    approval_url: minted.data.approvalUrl,
    qr: minted.data.qrDataUrl,
  });
}
