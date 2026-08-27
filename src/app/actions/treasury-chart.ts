"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { getTreasuryWalletChart } from "@/lib/treasury-history";
import { CHART_PERIODS, type ChartPeriod } from "@/lib/zerion";

/**
 * Histórico das carteiras num período. Chamado pelo seletor do gráfico.
 *
 * O período vem do cliente, então é validado contra a lista fechada em vez de
 * repassado — um período arbitrário viraria caminho de URL na chamada à Zerion.
 */
export async function fetchWalletChart(
  period: string,
): Promise<{ ok: true; series: Awaited<ReturnType<typeof getTreasuryWalletChart>>["series"]; failed: string[] } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false, error: "Não autorizado." };

  const p = (CHART_PERIODS as readonly string[]).includes(period) ? (period as ChartPeriod) : "month";
  const isSopa = project.slug === "sopa";
  const r = await getTreasuryWalletChart(p, isSopa ? undefined : { slug: project.slug }).catch(() => null);
  if (!r) return { ok: false, error: "Falha ao ler o histórico." };
  return { ok: true, series: r.series, failed: r.failed };
}
