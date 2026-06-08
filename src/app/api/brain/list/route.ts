import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects";
import { buildBrainTree, workspaceForProject } from "@/lib/brain-workspace";

export const runtime = "nodejs";

// Lists the active project's agent brain files. The agent is derived
// server-side from the active project — a client cannot request another
// tenant's agent. The `sessions` folder is excluded by buildBrainTree.
export async function GET() {
  const project = await getActiveProject();

  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const workspace = workspaceForProject(project);
  try {
    const tree = await buildBrainTree(workspace);
    return NextResponse.json({
      ok: true,
      data: { agentId: project.agent.id, agentName: project.agent.displayName, tree },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
