"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import {
  fetchUsdBrl,
  toCostDTO,
  type Cadence,
  type CostCategory,
  type Currency,
  type FixedCostDTO,
} from "@/lib/fixed-costs";

// ---------------------------------------------------------------------------
// Gate — any allowlisted member of the active portal may edit costs. The
// "scope" is the active project plus any treasuries it rolls up
// (`includeProjects`), so SOPA can manage every project's costs while a brand
// portal is limited to its own.
// ---------------------------------------------------------------------------

async function gate() {
  const project = await getActiveProject();
  if (!project.treasury) return { ok: false as const, error: "Tesouro não habilitado." };
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Não autorizado." };
  const scope = [project.slug, ...(project.treasury.includeProjects ?? [])];
  return { ok: true as const, project, username: session.username, scope };
}

const CURRENCIES: Currency[] = ["USD", "BRL"];
const CADENCES: Cadence[] = ["monthly", "yearly"];
const CATEGORIES: CostCategory[] = ["infra", "salary", "tooling", "service", "other"];

function clean(input: {
  projectSlug: string;
  label: string;
  amount: number;
  currency: string;
  cadence: string;
  category?: string | null;
  notes?: string | null;
  active?: boolean;
}) {
  const label = input.label.trim().slice(0, 120);
  const amount = Number(input.amount);
  const currency: Currency = CURRENCIES.includes(input.currency as Currency) ? (input.currency as Currency) : "USD";
  const cadence: Cadence = CADENCES.includes(input.cadence as Cadence) ? (input.cadence as Cadence) : "monthly";
  const category = input.category && CATEGORIES.includes(input.category as CostCategory) ? (input.category as CostCategory) : null;
  return {
    label,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : NaN,
    currency,
    cadence,
    category,
    notes: input.notes?.trim().slice(0, 500) || null,
    active: input.active ?? true,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listFixedCosts(): Promise<
  { ok: true; costs: FixedCostDTO[]; usdBrl: number } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const [usdBrl, rows] = await Promise.all([
    fetchUsdBrl(),
    prisma.fixedCost.findMany({
      where: { projectSlug: { in: g.scope } },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  return { ok: true, costs: rows.map((r) => toCostDTO(r, usdBrl)), usdBrl };
}

export async function createFixedCost(input: {
  projectSlug: string;
  label: string;
  amount: number;
  currency: string;
  cadence: string;
  category?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; cost: FixedCostDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!g.scope.includes(input.projectSlug)) return { ok: false, error: "Projeto fora do escopo." };
  const c = clean(input);
  if (!c.label) return { ok: false, error: "Dê um nome ao custo." };
  if (!Number.isFinite(c.amount)) return { ok: false, error: "Valor inválido." };
  const usdBrl = await fetchUsdBrl();
  const row = await prisma.fixedCost.create({
    data: {
      projectSlug: input.projectSlug,
      label: c.label,
      amount: c.amount,
      currency: c.currency,
      cadence: c.cadence,
      category: c.category,
      notes: c.notes,
      createdBy: g.username,
    },
  });
  revalidatePath("/treasury");
  return { ok: true, cost: toCostDTO(row, usdBrl) };
}

export async function updateFixedCost(
  id: string,
  patch: {
    label?: string;
    amount?: number;
    currency?: string;
    cadence?: string;
    category?: string | null;
    notes?: string | null;
    active?: boolean;
  },
): Promise<{ ok: true; cost: FixedCostDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.fixedCost.findUnique({ where: { id } });
  if (!existing || !g.scope.includes(existing.projectSlug)) return { ok: false, error: "Custo não encontrado." };

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim().slice(0, 120);
    if (!label) return { ok: false, error: "Dê um nome ao custo." };
    data.label = label;
  }
  if (patch.amount !== undefined) {
    const amount = Number(patch.amount);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Valor inválido." };
    data.amount = amount;
  }
  if (patch.currency !== undefined) data.currency = CURRENCIES.includes(patch.currency as Currency) ? patch.currency : "USD";
  if (patch.cadence !== undefined) data.cadence = CADENCES.includes(patch.cadence as Cadence) ? patch.cadence : "monthly";
  if (patch.category !== undefined)
    data.category = patch.category && CATEGORIES.includes(patch.category as CostCategory) ? patch.category : null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim().slice(0, 500) || null;
  if (patch.active !== undefined) data.active = patch.active;

  const [usdBrl, row] = await Promise.all([
    fetchUsdBrl(),
    prisma.fixedCost.update({ where: { id }, data }),
  ]);
  revalidatePath("/treasury");
  return { ok: true, cost: toCostDTO(row, usdBrl) };
}

export async function deleteFixedCost(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.fixedCost.findUnique({ where: { id } });
  if (!existing || !g.scope.includes(existing.projectSlug)) return { ok: false, error: "Custo não encontrado." };
  await prisma.fixedCost.delete({ where: { id } });
  revalidatePath("/treasury");
  return { ok: true };
}
