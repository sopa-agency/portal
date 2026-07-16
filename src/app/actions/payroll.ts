"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

// Payroll stream members — the registry behind SOPA's Superfluid distribution
// pool (label + wallet + units/weight). SOPA-scoped; reads open within the
// authed portal, writes require a logged-in SOPA member.

export type PayrollMemberDTO = {
  id: string;
  label: string;
  address: string;
  units: number;
  active: boolean;
};

const SLUG = "sopa";
const isAddress = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a.trim());

type Row = { id: string; label: string; address: string; units: number; active: boolean };
const toDTO = (r: Row): PayrollMemberDTO => ({ id: r.id, label: r.label, address: r.address, units: r.units, active: r.active });

async function gate() {
  const project = await getActiveProject();
  if (project.slug !== SLUG) return { ok: false as const, error: "Stream de pagamentos é só da SOPA." };
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, username: session.username };
}

export async function listPayrollMembers(): Promise<{ ok: true; members: PayrollMemberDTO[] } | { ok: false; error: string }> {
  try {
    const rows = await prisma.payrollMember.findMany({
      where: { projectSlug: SLUG },
      orderBy: [{ active: "desc" }, { units: "desc" }, { createdAt: "asc" }],
    });
    return { ok: true, members: rows.map(toDTO) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}

export async function createPayrollMember(input: {
  label: string;
  address: string;
  units: number;
}): Promise<{ ok: true; member: PayrollMemberDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const label = input.label.trim().slice(0, 80);
  const address = input.address.trim();
  const units = Math.round(Number(input.units));
  if (!label) return { ok: false, error: "Dê um nome ao membro." };
  if (!isAddress(address)) return { ok: false, error: "Endereço EVM inválido (0x… 40 hex)." };
  if (!Number.isFinite(units) || units < 0) return { ok: false, error: "Peso (units) inválido." };
  const dupe = await prisma.payrollMember.findFirst({ where: { projectSlug: SLUG, address: { equals: address, mode: "insensitive" } } });
  if (dupe) return { ok: false, error: "Já existe um membro com essa carteira." };
  const row = await prisma.payrollMember.create({
    data: { projectSlug: SLUG, label, address, units, addedBy: g.username },
  });
  revalidatePath("/treasury");
  return { ok: true, member: toDTO(row) };
}

export async function updatePayrollMember(
  id: string,
  patch: { label?: string; address?: string; units?: number; active?: boolean },
): Promise<{ ok: true; member: PayrollMemberDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.payrollMember.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== SLUG) return { ok: false, error: "Membro não encontrado." };

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim().slice(0, 80);
    if (!label) return { ok: false, error: "Nome não pode ficar vazio." };
    data.label = label;
  }
  if (patch.address !== undefined) {
    const address = patch.address.trim();
    if (!isAddress(address)) return { ok: false, error: "Endereço EVM inválido." };
    data.address = address;
  }
  if (patch.units !== undefined) {
    const units = Math.round(Number(patch.units));
    if (!Number.isFinite(units) || units < 0) return { ok: false, error: "Peso (units) inválido." };
    data.units = units;
  }
  if (patch.active !== undefined) data.active = !!patch.active;

  const row = await prisma.payrollMember.update({ where: { id }, data });
  revalidatePath("/treasury");
  return { ok: true, member: toDTO(row) };
}

export async function deletePayrollMember(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.payrollMember.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== SLUG) return { ok: false, error: "Membro não encontrado." };
  await prisma.payrollMember.delete({ where: { id } });
  revalidatePath("/treasury");
  return { ok: true };
}
