import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addSubscriber, paragraphApiKey, removeSubscriber } from "@/lib/paragraph";
import { getActiveProject } from "@/projects/index";

// Server-to-server endpoint for the skatehive.app settings toggle (and any
// future frontend). Gated by a shared secret header — NOT a public form
// endpoint like /subscribe. Semantics follow the OPT-OUT model: an email with
// no preference row counts as subscribed.
//
// POST { email }                  → read  → { ok, subscribed }
// POST { email, subscribed }      → write → { ok, subscribed } (also adds/
//                                   removes the email on Paragraph, best-effort)

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.NEWSLETTER_API_SECRET;
  if (!secret || req.headers.get("x-newsletter-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as { email?: string; subscribed?: boolean } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email." }, { status: 400 });
    }

    if (typeof body?.subscribed !== "boolean") {
      const pref = await prisma.newsletterPref.findUnique({ where: { email } });
      return NextResponse.json({ ok: true, subscribed: pref ? pref.subscribed : true });
    }

    const project = await getActiveProject();
    await prisma.newsletterPref.upsert({
      where: { email },
      create: { email, subscribed: body.subscribed, source: "settings-toggle", projectSlug: project.slug },
      update: { subscribed: body.subscribed, source: "settings-toggle" },
    });

    // Mirror to Paragraph best-effort — the local pref already excludes them
    // from our blasts either way, and sync re-converges later.
    const apiKey = paragraphApiKey(project);
    if (apiKey) {
      try {
        if (body.subscribed) await addSubscriber(apiKey, { email });
        else await removeSubscriber(apiKey, email);
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({ ok: true, subscribed: body.subscribed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Preference update failed." },
      { status: 500 },
    );
  }
}
