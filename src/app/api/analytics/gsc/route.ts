import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { fetchGsc } from "@/lib/google-analytics";

export const runtime = "nodejs";

function parseDays(raw: string | null): 7 | 28 | 90 {
  if (raw === "7") return 7;
  if (raw === "90") return 90;
  return 28;
}

export async function GET(request: NextRequest) {
  const project = await getActiveProject();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, project);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = parseDays(request.nextUrl.searchParams.get("days"));
  const result = await fetchGsc(project, days);
  return NextResponse.json(result);
}
