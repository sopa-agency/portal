import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addSubscriber, paragraphApiKey } from "@/lib/paragraph";
import { getActiveProject } from "@/projects/index";

// Public endpoint (allowed through the proxy, CORS-open) used by the
// skatehive.app login dialog's "subscribe to the newsletter" checkbox.
// Adds the email to the project's Paragraph publication (server-side key) and
// records the explicit opt-in locally. Paragraph dedupes repeats, every email
// it sends carries an unsubscribe link, and subscribing is idempotent — so an
// open endpoint is the standard newsletter-form risk, no worse.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      return NextResponse.json({ ok: false, error: "Invalid email." }, { status: 400, headers: CORS });
    }

    const project = await getActiveProject();
    const apiKey = paragraphApiKey(project);
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Newsletter not configured for this project." },
        { status: 503, headers: CORS },
      );
    }

    await addSubscriber(apiKey, { email });
    // Explicit opt-in also clears any older local opt-out.
    await prisma.newsletterPref.upsert({
      where: { email },
      create: { email, subscribed: true, source: "frontend-checkbox", projectSlug: project.slug },
      update: { subscribed: true, source: "frontend-checkbox" },
    });

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Subscribe failed." },
      { status: 500, headers: CORS },
    );
  }
}
