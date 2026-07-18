"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

// Treasury earmarks: what share of the (single, staked) pot is meant for
// salaries, operating costs and free budget. Labels on one pot — no money moves
// when these change.

export type Allocation = { salariosPct: number; custosPct: number; orcamentoPct: number };

const DEFAULT: Allocation = { salariosPct: 50, custosPct: 15, orcamentoPct: 35 };

export async function getAllocation(projectSlug: string): Promise<Allocation> {
  try {
    const row = await prisma.treasuryAllocation.findUnique({ where: { projectSlug } });
    return row ? { salariosPct: row.salariosPct, custosPct: row.custosPct, orcamentoPct: row.orcamentoPct } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export async function setAllocation(
  input: Allocation,
): Promise<{ ok: true; allocation: Allocation } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Não autorizado." };

  const clean = {
    salariosPct: Math.max(0, Math.round(Number(input.salariosPct) || 0)),
    custosPct: Math.max(0, Math.round(Number(input.custosPct) || 0)),
    orcamentoPct: Math.max(0, Math.round(Number(input.orcamentoPct) || 0)),
  };
  const total = clean.salariosPct + clean.custosPct + clean.orcamentoPct;
  if (total === 0) return { ok: false, error: "Defina ao menos uma fatia." };
  if (total > 100) return { ok: false, error: `As fatias somam ${total}% — o total não pode passar de 100%.` };

  try {
    await prisma.treasuryAllocation.upsert({
      where: { projectSlug: project.slug },
      update: { ...clean, updatedBy: session.username },
      create: { projectSlug: project.slug, ...clean, updatedBy: session.username },
    });
    revalidatePath("/treasury");
    return { ok: true, allocation: clean };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}
