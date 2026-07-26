"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";

// ---------------------------------------------------------------------------
// Briefs sent through the PUBLIC SOPA site's contact form. The rows are written
// by /api/sopa/brief (anonymous, open to the internet); everything here is the
// read side, and it is SOPA-only + session-gated — the opposite of the writer.
// ---------------------------------------------------------------------------

export type Brief = {
  id: string;
  name: string;
  contact: string;
  types: string[];
  budget: string | null;
  deadline: string | null;
  message: string;
  handled: boolean;
  createdAt: string;
};

/** Any logged-in member of the SOPA portal may read and triage the briefs. */
async function gate() {
  const project = await getActiveProject();
  if (project.slug !== "sopa") return { ok: false as const, error: "Briefs só existem no portal da SOPA." };
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, who };
}

/** Newest first, pending before handled — the triage order. */
export async function listBriefs(): Promise<{ ok: true; briefs: Brief[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;

  const rows = await prisma.sopaBrief.findMany({
    orderBy: [{ handled: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return {
    ok: true,
    briefs: rows.map((r) => ({
      id: r.id,
      name: r.name,
      contact: r.contact,
      types: r.types,
      budget: r.budget,
      deadline: r.deadline,
      message: r.message,
      handled: r.handled,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Mark a brief as picked up (or put it back in the queue). */
export async function setBriefHandled(
  id: string,
  handled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;

  try {
    await prisma.sopaBrief.update({ where: { id }, data: { handled } });
    revalidatePath("/briefs");
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha ao atualizar o brief." };
  }
}
