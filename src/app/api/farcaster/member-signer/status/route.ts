import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { checkSignerStatus } from "@/lib/farcaster-sponsor";

export const runtime = "nodejs";

// Poll a member's pending signer. When Warpcast approval lands, persist the
// approved signer (fid + handle) against the member.
export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const signerUuid = req.nextUrl.searchParams.get("signer_uuid")?.trim();
  if (!signerUuid) return NextResponse.json({ error: "signer_uuid ausente." }, { status: 400 });

  // The signer must be the one we minted for THIS member.
  const row = await prisma.farcasterMemberSigner.findUnique({ where: { username: who.username } }).catch(() => null);
  if (!row || row.signerUuid !== signerUuid) {
    return NextResponse.json({ error: "Signer não pertence a este membro." }, { status: 403 });
  }

  const st = await checkSignerStatus(signerUuid);
  if (st.status === "approved" && st.fid) {
    await prisma.farcasterMemberSigner
      .update({
        where: { username: who.username },
        data: { status: "approved", fid: st.fid, handle: st.handle ?? null },
      })
      .catch(() => {});
    return NextResponse.json({ status: "approved", handle: st.handle, fid: st.fid });
  }
  return NextResponse.json({ status: st.status });
}
