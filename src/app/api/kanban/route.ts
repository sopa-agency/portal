import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { fetchGitHubProject } from "@/lib/github-project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const project = await getActiveProject();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, project);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchGitHubProject(project);
  return NextResponse.json(result);
}
