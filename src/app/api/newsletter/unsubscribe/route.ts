import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/newsletter";
import { getActiveProject } from "@/projects/index";

// Public endpoint (allowed through the proxy) hit from the unsubscribe link in
// blast emails. GET so it works from any mail client; the HMAC token prevents
// third parties from unsubscribing addresses they don't control.

function page(title: string, message: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0a0a0a;color:#fafafa;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:420px;padding:32px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
<p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:0;">${message}</p>
</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return page("Invalid link", "This unsubscribe link is invalid or incomplete. Reply to the newsletter and we'll remove you by hand.", 400);
  }

  const project = await getActiveProject();
  await prisma.newsletterPref.upsert({
    where: { email },
    create: { email, subscribed: false, source: "unsubscribe-link", projectSlug: project.slug },
    update: { subscribed: false, source: "unsubscribe-link" },
  });

  return page(
    "You're unsubscribed",
    `${email} won't receive ${project.name} newsletter emails anymore. Changed your mind? Just reply to any past email and we'll add you back.`,
  );
}
