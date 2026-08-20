import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { fetchChannelMetrics } from "@/lib/social-metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const project = await getActiveProject();

  // Auth check
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, project);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find requested channel
  const platform = req.nextUrl.searchParams.get("platform");
  if (!platform) {
    return NextResponse.json({ error: "Missing ?platform= param" }, { status: 400 });
  }

  const channel = project.socials.find(
    (c) => c.platform.toLowerCase() === platform.toLowerCase(),
  );
  if (!channel) {
    return NextResponse.json(
      { error: `No channel "${platform}" configured for project "${project.slug}"` },
      { status: 404 },
    );
  }

  const account =
    channel.metricsAccount ?? channel.handle?.replace(/^@/, "");

  const metrics = await fetchChannelMetrics(channel.platform, account, project);
  return NextResponse.json(metrics);
}
