"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

// SOPA agency job revenue (client gigs like the Venice bot). Manual entries,
// SOPA-scoped. Reads are open within the authed portal; writes require a
// logged-in SOPA member (same bar as fixed costs).

export type JobStatus = "paid" | "pending";

export type SopaJobDTO = {
  id: string;
  client: string;
  description: string | null;
  amountUsd: number;
  status: JobStatus;
  occurredOn: string; // yyyy-mm-dd
  createdBy: string | null;
  /** Quem TROUXE o job. Dupla e trio valem; o mérito se divide por igual. */
  credit: string[];
};

/** Usernames limpos, sem repetição e sem vazio — igual ao dos streams. */
const asCredit = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter(Boolean))]
    : [];

const SLUG = "sopa";

type JobRow = {
  id: string;
  client: string;
  description: string | null;
  amountUsd: number;
  status: string;
  occurredOn: Date;
  createdBy: string | null;
  credit?: string[];
};

function toDTO(r: JobRow): SopaJobDTO {
  return {
    id: r.id,
    client: r.client,
    description: r.description,
    amountUsd: r.amountUsd,
    status: r.status === "pending" ? "pending" : "paid",
    credit: asCredit(r.credit),
    occurredOn: r.occurredOn.toISOString().slice(0, 10),
    createdBy: r.createdBy,
  };
}

async function gate() {
  const project = await getActiveProject();
  if (project.slug !== SLUG) return { ok: false as const, error: "Jobs são só da SOPA." };
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, username: session.username };
}

function clean(input: { client: string; amountUsd: number; occurredOn: string; description?: string | null; status?: string }) {
  const client = input.client.trim().slice(0, 120);
  const amountUsd = Number(input.amountUsd);
  const status: JobStatus = input.status === "pending" ? "pending" : "paid";
  const occurredOn = new Date(`${input.occurredOn}T00:00:00`);
  return {
    client,
    amountUsd: Number.isFinite(amountUsd) && amountUsd >= 0 ? amountUsd : NaN,
    status,
    occurredOn,
    description: input.description?.trim().slice(0, 500) || null,
    validDate: !Number.isNaN(occurredOn.getTime()),
  };
}

export async function listSopaJobs(): Promise<{ ok: true; jobs: SopaJobDTO[] } | { ok: false; error: string }> {
  try {
    const rows = await prisma.sopaJob.findMany({
      where: { projectSlug: SLUG },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    });
    return { ok: true, jobs: rows.map(toDTO) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}

export async function createSopaJob(input: {
  client: string;
  amountUsd: number;
  occurredOn: string;
  description?: string | null;
  status?: string;
  credit?: string[];
}): Promise<{ ok: true; job: SopaJobDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const c = clean(input);
  if (!c.client) return { ok: false, error: "Diga para quem foi o job (cliente)." };
  if (!Number.isFinite(c.amountUsd)) return { ok: false, error: "Valor inválido." };
  if (!c.validDate) return { ok: false, error: "Data inválida." };
  const row = await prisma.sopaJob.create({
    data: {
      projectSlug: SLUG,
      client: c.client,
      amountUsd: c.amountUsd,
      status: c.status,
      occurredOn: c.occurredOn,
      description: c.description,
      credit: asCredit(input.credit),
      createdBy: g.username,
    },
  });
  revalidatePath("/treasury");
  return { ok: true, job: toDTO(row) };
}

export async function updateSopaJob(
  id: string,
  patch: { client?: string; amountUsd?: number; occurredOn?: string; description?: string | null; status?: string; credit?: string[] },
): Promise<{ ok: true; job: SopaJobDTO } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.sopaJob.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== SLUG) return { ok: false, error: "Job não encontrado." };

  const data: Record<string, unknown> = {};
  if (patch.credit !== undefined) data.credit = asCredit(patch.credit);
  if (patch.client !== undefined) {
    const client = patch.client.trim().slice(0, 120);
    if (!client) return { ok: false, error: "Cliente não pode ficar vazio." };
    data.client = client;
  }
  if (patch.amountUsd !== undefined) {
    const amount = Number(patch.amountUsd);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Valor inválido." };
    data.amountUsd = amount;
  }
  if (patch.occurredOn !== undefined) {
    const d = new Date(`${patch.occurredOn}T00:00:00`);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Data inválida." };
    data.occurredOn = d;
  }
  if (patch.status !== undefined) data.status = patch.status === "pending" ? "pending" : "paid";
  if (patch.description !== undefined) data.description = patch.description?.trim().slice(0, 500) || null;

  const row = await prisma.sopaJob.update({ where: { id }, data });
  revalidatePath("/treasury");
  return { ok: true, job: toDTO(row) };
}

export async function deleteSopaJob(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const existing = await prisma.sopaJob.findUnique({ where: { id } });
  if (!existing || existing.projectSlug !== SLUG) return { ok: false, error: "Job não encontrado." };
  await prisma.sopaJob.delete({ where: { id } });
  revalidatePath("/treasury");
  return { ok: true };
}
