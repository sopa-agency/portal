import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeHomepageDoc } from "@/lib/homepage-config";

export const dynamic = "force-dynamic";

// Preview endpoint: fetch ANY version's draft doc by its unguessable capability
// token (minted in the portal composer). The token IS the auth — this route
// never lists or accepts project/version params, so drafts stay non-enumerable.
// no-store so a preview tab always reflects the latest save; revocable in the
// portal. sk3 renders it behind a "PREVIEW — DRAFT" ribbon with no-referrer.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return NextResponse.json({ config: null, error: "missing token" }, { status: 400, headers: CORS });

  const row = await prisma.homepageConfig.findUnique({ where: { previewToken: token } }).catch(() => null);
  if (!row) return NextResponse.json({ config: null, error: "not found" }, { status: 404, headers: CORS });

  return NextResponse.json(
    {
      config: sanitizeHomepageDoc(row.data),
      version: row.version,
      status: row.status,
      preview: true,
    },
    { headers: CORS },
  );
}
