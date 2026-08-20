"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import {
  generateInsightForChannel,
} from "@/lib/social-insights-core";

// ---------------------------------------------------------------------------
// generateSocialInsights — auth-gated, persists via generateInsightForChannel
// ---------------------------------------------------------------------------

export async function generateSocialInsights(
  platform: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();

    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    const channel = project.socials.find(
      (c) => c.platform.toLowerCase() === platform.toLowerCase(),
    );
    if (!channel)
      return { ok: false, error: `No ${platform} channel configured for this project.` };

    const result = await generateInsightForChannel(
      project,
      channel,
      session.username,
    );

    if (!result.ok) {
      // Translate the not-connected error message to match the original UX copy.
      const errMsg = result.error.includes("not connected")
        ? "This channel isn't connected yet — connect its metrics first."
        : result.error;
      return { ok: false, error: errMsg };
    }

    return { ok: true, text: result.text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getLatestSocialInsight — auth-gated read from DB for hydration on mount
// ---------------------------------------------------------------------------

export async function getLatestSocialInsight(
  platform: string,
): Promise<{ body: string; generatedAt: string; generatedBy: string | null } | null> {
  try {
    const project = await getActiveProject();

    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return null;

    const row = await prisma.socialInsight.findUnique({
      where: {
        projectSlug_platform: {
          projectSlug: project.slug,
          platform: platform.toLowerCase(),
        },
      },
      select: { body: true, generatedAt: true, generatedBy: true },
    });

    if (!row) return null;

    return {
      body: row.body,
      generatedAt: row.generatedAt.toISOString(),
      generatedBy: row.generatedBy,
    };
  } catch {
    return null;
  }
}
