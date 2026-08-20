import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { mintMemberSigner, sponsorConfigured } from "@/lib/farcaster-sponsor";

export const runtime = "nodejs";

// Mint a managed signer + approval QR for the ACTIVE PROJECT's brand Farcaster
// account. An admin opens the QR/deep link and approves in the BRAND's Warpcast;
// /status then captures the approved signer into farcasterSigner[project].
//
// The signer is minted under the sponsor/generic Neynar app (farcaster-sponsor's
// engineApiKey) — the same app publishCastToFarcaster uses — so it works even
// when the project's own Neynar key is dead (e.g. gnars). Generic by project:
// no per-brand hardcoding. We DON'T write the DB here: persistence happens only
// when /status sees the approval, so an abandoned/expired attempt never clobbers
// an already-approved brand signer.
export async function POST() {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (who.role !== "admin") {
    return NextResponse.json({ error: "Apenas admins podem conectar o Farcaster da marca." }, { status: 403 });
  }
  if (!sponsorConfigured()) {
    return NextResponse.json({ error: "Sponsor de Farcaster não configurado neste ambiente (FARCASTER_SPONSOR_MNEMONIC / _FID)." }, { status: 503 });
  }

  const minted = await mintMemberSigner();
  if (!minted.ok) return NextResponse.json({ error: minted.error }, { status: 502 });

  return NextResponse.json({
    ok: true,
    signer_uuid: minted.data.signerUuid,
    approval_url: minted.data.approvalUrl,
    qr: minted.data.qrDataUrl,
  });
}
