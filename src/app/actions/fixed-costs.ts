"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import {
  currentMonthKey,
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

const asCurrency = (c: string): Currency => (CURRENCIES.includes(c as Currency) ? (c as Currency) : "USD");

function clean(input: {
  projectSlug: string;
  label: string;
  amount: number;
  currency: string;
  cadence: string;
  category?: string | null;
  notes?: string | null;
  active?: boolean;
  variable?: boolean;
}) {
  const label = input.label.trim().slice(0, 120);
  const amount = Number(input.amount);
  const variable = !!input.variable;
  const cadenceRaw: Cadence = CADENCES.includes(input.cadence as Cadence) ? (input.cadence as Cadence) : "monthly";
  const category = input.category && CATEGORIES.includes(input.category as CostCategory) ? (input.category as CostCategory) : null;
  return {
    label,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : NaN,
    currency: asCurrency(input.currency),
    // Variable costs bill monthly (plan + overage) — never yearly.
    cadence: variable ? ("monthly" as Cadence) : cadenceRaw,
    category,
    notes: input.notes?.trim().slice(0, 500) || null,
    active: input.active ?? true,
    variable,
  };
}

const WITH_ACTUALS = { include: { actuals: true } } as const;

/** Reload a cost (with actuals) and build its DTO for the current month. */
async function reload(id: string, usdBrl: number): Promise<FixedCostDTO | null> {
  const row = await prisma.fixedCost.findUnique({ where: { id }, ...WITH_ACTUALS });
  return row ? toCostDTO(row, usdBrl, currentMonthKey()) : null;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listFixedCosts(): Promise<
  { ok: true; costs: FixedCostDTO[]; usdBrl: number } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const month = currentMonthKey();
  const [usdBrl, rows] = await Promise.all([
    fetchUsdBrl(),
    prisma.fixedCost.findMany({
      where: { projectSlug: { in: g.scope } },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      ...WITH_ACTUALS,
    }),
  ]);
  return { ok: true, costs: rows.map((r) => toCostDTO(r, usdBrl, month)), usdBrl };
}

export async function createFixedCost(input: {
  projectSlug: string;
  label: string;
  amount: number;
  currency: string;
  cadence: string;
  category?: string | null;
  notes?: string | null;
  variable?: boolean;
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
      variable: c.variable,
      createdBy: g.username,
    },
    ...WITH_ACTUALS,
  });
  revalidatePath("/treasury");
  return { ok: true, cost: toCostDTO(row, usdBrl, currentMonthKey()) };
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
    variable?: boolean;
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
  if (patch.currency !== undefined) data.currency = asCurrency(patch.currency);
  if (patch.variable !== undefined) {
    data.variable = patch.variable;
    if (patch.variable) data.cadence = "monthly"; // variable costs are always monthly
  }
  if (patch.cadence !== undefined && !(data.variable === true))
    data.cadence = CADENCES.includes(patch.cadence as Cadence) ? patch.cadence : "monthly";
  if (patch.category !== undefined)
    data.category = patch.category && CATEGORIES.includes(patch.category as CostCategory) ? patch.category : null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim().slice(0, 500) || null;
  if (patch.active !== undefined) data.active = patch.active;

  const [usdBrl, row] = await Promise.all([
    fetchUsdBrl(),
    prisma.fixedCost.update({ where: { id }, data, ...WITH_ACTUALS }),
  ]);
  revalidatePath("/treasury");
  return { ok: true, cost: toCostDTO(row, usdBrl, currentMonthKey()) };
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

// ---------------------------------------------------------------------------
// Monthly actuals — the real billed amount for a variable cost in a month.
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function setMonthlyActual(
  costId: string,
  input: { month?: string; amount: number; currency?: string; note?: string | null },
): Promise<{ ok: true; cost: FixedCostDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const cost = await prisma.fixedCost.findUnique({ where: { id: costId } });
  if (!cost || !g.scope.includes(cost.projectSlug)) return { ok: false, error: "Custo não encontrado." };

  const month = input.month && MONTH_RE.test(input.month) ? input.month : currentMonthKey();
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Valor inválido." };
  const currency = asCurrency(input.currency ?? cost.currency);
  const note = input.note?.trim().slice(0, 300) || null;

  await prisma.fixedCostActual.upsert({
    where: { costId_month: { costId, month } },
    create: { costId, month, amount, currency, note, createdBy: g.username },
    update: { amount, currency, note },
  });
  const usdBrl = await fetchUsdBrl();
  const dto = await reload(costId, usdBrl);
  revalidatePath("/treasury");
  return dto ? { ok: true, cost: dto } : { ok: false, error: "Falha ao recarregar." };
}

export async function clearMonthlyActual(
  costId: string,
  month?: string,
): Promise<{ ok: true; cost: FixedCostDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const cost = await prisma.fixedCost.findUnique({ where: { id: costId } });
  if (!cost || !g.scope.includes(cost.projectSlug)) return { ok: false, error: "Custo não encontrado." };
  const m = month && MONTH_RE.test(month) ? month : currentMonthKey();
  await prisma.fixedCostActual.deleteMany({ where: { costId, month: m } });
  const usdBrl = await fetchUsdBrl();
  const dto = await reload(costId, usdBrl);
  revalidatePath("/treasury");
  return dto ? { ok: true, cost: dto } : { ok: false, error: "Falha ao recarregar." };
}
