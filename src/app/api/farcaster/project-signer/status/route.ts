import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { checkSignerStatus } from "@/lib/farcaster-sponsor";

export const runtime = "nodejs";

// Poll a pending brand signer. When the Warpcast approval lands, persist it as
// the project's approved Farcaster signer (farcasterSigner[project]). This upsert
// is the ONLY DB write in the flow — it happens as a direct result of the admin's
// approval in Warpcast, never speculatively, so abandoning the QR leaves any
// existing approved signer untouched. Same trust model as the SIWN connect route.
export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who || who.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const signerUuid = req.nextUrl.searchParams.get("signer_uuid")?.trim();
  if (!signerUuid) return NextResponse.json({ error: "signer_uuid ausente." }, { status: 400 });

  const st = await checkSignerStatus(signerUuid);
  if (st.status === "approved" && st.fid) {
    await prisma.farcasterSigner.upsert({
      where: { projectSlug: project.slug },
      update: { signerUuid, fid: st.fid, username: st.handle ?? null, status: "approved", connectedBy: who.username },
      create: { projectSlug: project.slug, signerUuid, fid: st.fid, username: st.handle ?? null, status: "approved", connectedBy: who.username },
    });
    return NextResponse.json({ status: "approved", handle: st.handle, fid: st.fid });
  }
  return NextResponse.json({ status: st.status });
}
