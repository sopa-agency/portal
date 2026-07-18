export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { SetupGuide, CodeBlock } from "@/components/setup-guide";
import { TreasuryViews } from "@/components/treasury-views";
import { TreasuryRefresh } from "@/components/treasury-refresh";
import { SafeActivity, type SafeActivityItem } from "@/components/safe-activity";
import { MultisigBudgets, type ProjectBudget } from "@/components/multisig-budget";
import { FixedCostsPanel } from "@/components/fixed-costs-panel";
import { TreasuryRevenue } from "@/components/treasury-revenue";
import { getOrgRevenue } from "@/lib/org-revenue";
import { SopaRevenuePanel, type OnchainShare } from "@/components/sopa-revenue-panel";
import { listSopaJobs } from "@/app/actions/sopa-jobs";
import { PayrollPanel, type PayrollRosterOption } from "@/components/payroll-panel";
import { listPayrollMembers } from "@/app/actions/payroll";
import { getTeamRoster } from "@/lib/team-roster";
import { StreamStatus } from "@/components/stream-status";
import { CreatePoolButton } from "@/components/create-pool-button";
import { StreamActions } from "@/components/stream-actions";
import { StreamFlowView } from "@/components/stream-flow-view";
import { StreamSustainability } from "@/components/stream-sustainability";
import { getStreamStatus, findSopaPool, SOPA_POOL_ADDRESS, SOPA_SAFE, SUPERFLUID } from "@/lib/superfluid";
import { ConnectPoolButton } from "@/components/connect-pool-button";
import { StakingPanel } from "@/components/staking-panel";
import { getStakePosition } from "@/lib/staking";
import { TreasuryTabs } from "@/components/treasury-tabs";
import { FinancialPlan } from "@/components/financial-plan";
import { SopaTreasury } from "@/components/sopa-treasury";
import { buildFinancialDashboardViews } from "@/lib/financial-dashboard";

// Agency's on-chain cut of the brand swap splits (SkateHive + Gnars split 50%
// with the SOPA treasury).
const SOPA_SPLIT_SHARE = 0.5;
import { fetchTreasuryGroups, getPrices } from "@/lib/treasury";
import { fetchSafeActivity, fetchSafeBudget } from "@/lib/safe-tx";
import { fetchCostScope } from "@/lib/fixed-costs-data";
import { getActiveProject, getAllProjects } from "@/projects";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function TreasuryPage() {
  const project = await getActiveProject();

  if (!project.treasury) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Treasury"
          title={`${project.name} treasury`}
          description="Live balances of the project's wallets across chains."
        />
        <SetupGuide
          feature="Treasury"
          intro={`Para mostrar o tesouro do ${project.name}, o portal só precisa saber quais carteiras acompanhar — as fontes de dados são públicas (Zapper, RPC da Base, Hive, CoinGecko), sem chave nenhuma.`}
          steps={[
            {
              title: "Levante os endereços do tesouro",
              body: (
                <>
                  Carteiras EVM (multisig, treasury contract, hot wallet — Ethereum ou Base) e/ou
                  contas Hive da comunidade. Qualquer combinação funciona; cada carteira vira um
                  card com saldo ao vivo.
                </>
              ),
            },
            {
              title: "Adicione o bloco treasury no config do projeto",
              body: (
                <CodeBlock>{`// src/projects/${project.slug}.ts
treasury: {
  ethWallets: [
    { label: "Treasury Multisig", address: "0x..." },
  ],
  hiveAccounts: [
    { label: "Conta da comunidade", account: "nome-da-conta" },
  ],
},`}</CodeBlock>
              ),
            },
            {
              title: "Deploy",
              body: (
                <>
                  Build + deploy e pronto — o item some deste estado e mostra os saldos. Sem env
                  vars: os dados vêm de APIs públicas com cache de 5 minutos.
                </>
              ),
            },
          ]}
        />
      </div>
    );
  }

  const groups = await fetchTreasuryGroups(project);
  const combined = groups.reduce((s, g) => s + g.report.grandTotalUsd, 0);

  // Surface Safe transaction activity. Candidates = EVM treasury wallets (chain
  // unknown → probe Base + mainnet) plus the project's configured bounty Safes
  // (known chain). A wallet may be a Safe on either chain.
  const slugs = [project.slug, ...(project.treasury?.includeProjects ?? [])];
  const bountyConfigs = await prisma.bountyConfig.findMany({ where: { projectSlug: { in: slugs } } }).catch(() => []);
  const nameOf = (slug: string) => getAllProjects().find((p) => p.slug === slug)?.name ?? slug;

  // address(lower) → { label, address, chains[] }. Bounty Safes pin their chain.
  const candidates = new Map<string, { label: string; address: string; chains: number[] }>();
  for (const g of groups) for (const w of g.report.evm) {
    const k = w.address.toLowerCase();
    if (!candidates.has(k)) candidates.set(k, { label: w.label, address: w.address, chains: [8453, 1] });
  }
  for (const bc of bountyConfigs) {
    const k = bc.safeAddress.toLowerCase();
    const existing = candidates.get(k);
    candidates.set(k, { label: existing?.label ?? `${nameOf(bc.projectSlug)} bounty Safe`, address: bc.safeAddress, chains: [bc.chainId] });
  }

  const probed = await Promise.all(
    [...candidates.values()].map(async (w): Promise<SafeActivityItem | null> => {
      const perChain = await Promise.all(
        w.chains.map(async (chainId) => ({ chainId, activity: await fetchSafeActivity(w.address, chainId) })),
      );
      const hit =
        perChain.find((r) => r.activity.isSafe && (r.activity.queued.length > 0 || r.activity.history.length > 0)) ??
        perChain.find((r) => r.activity.isSafe);
      return hit ? { label: w.label, address: w.address, chainId: hit.chainId, activity: hit.activity } : null;
    }),
  );
  const safes = probed.filter((p): p is SafeActivityItem => p !== null && (p.activity.queued.length > 0 || p.activity.history.length > 0));

  // Operational budget: the configured bounty multisig(s) + spendable balances
  // per chain (USD valued), shown highlighted + separate from the DAO treasury.
  const { eth: ethPrice } = await getPrices();
  const budgets = (
    await Promise.all(
      bountyConfigs.map(async (bc): Promise<ProjectBudget | null> => {
        const chains = (await Promise.all([8453, 1].map((chainId) => fetchSafeBudget(bc.safeAddress, chainId, ethPrice)))).filter(
          (b): b is NonNullable<typeof b> => b !== null,
        );
        return chains.length ? { slug: bc.projectSlug, name: nameOf(bc.projectSlug), address: bc.safeAddress, chains } : null;
      }),
    )
  ).filter((b): b is ProjectBudget => b !== null);

  // Fixed costs + runway. Costs are scoped to the treasuries actually shown
  // (each group's slug), so a brand portal sees only its own and SOPA the lot.
  // `canEdit` = any allowlisted member of the active portal.
  const costGroups = groups.map((g) => ({ slug: g.slug, name: g.name, treasuryUsd: g.report.grandTotalUsd }));
  const isSopa = project.slug === "sopa";
  const [costScope, session, orgRevenue, jobsRes] = await Promise.all([
    fetchCostScope(costGroups.map((g) => g.slug)),
    verifySession((await cookies()).get(SESSION_COOKIE)?.value, project),
    // Revenue is tracked on the org-chart. On SOPA show every project (grouped);
    // on a brand portal show only that project's own streams.
    getOrgRevenue(isSopa ? undefined : { name: project.name, slug: project.slug }).catch(() => null),
    // SOPA agency revenue: client jobs (manual).
    isSopa ? listSopaJobs().catch(() => null) : Promise.resolve(null),
  ]);
  const payrollRes = isSopa ? await listPayrollMembers().catch(() => null) : null;
  // Team roster → payroll member picker (auto-detect an EVM wallet in contacts).
  const roster: PayrollRosterOption[] = isSopa
    ? (await getTeamRoster(project).catch(() => [])).map((m) => ({
        username: m.username,
        avatarUrl: m.avatarUrl,
        address: m.contacts.find((c) => /^0x[a-fA-F0-9]{40}$/.test(c.value.trim()))?.value.trim(),
      }))
    : [];

  const jobs = jobsRes && jobsRes.ok ? jobsRes.jobs : [];
  const payroll = payrollRes && payrollRes.ok ? payrollRes.members : [];
  // Pool address: hardcoded constant, else auto-discovered by admin = SOPA Safe.
  const poolAddress = isSopa ? SOPA_POOL_ADDRESS ?? (await findSopaPool().catch(() => null)) : null;
  const streamStatus = poolAddress ? await getStreamStatus(poolAddress).catch(() => null) : null;
  const stakePosition = isSopa ? await getStakePosition(SOPA_SAFE).catch(() => null) : null;
  // Agency's share = SOPA_SPLIT_SHARE of every tracked swap split's realized income.
  const onchainShare: OnchainShare[] =
    isSopa && orgRevenue
      ? orgRevenue.projects.flatMap((p) =>
          p.streams.flatMap((s, i) =>
            s.kind === "split" && s.realized && s.realized.revenueUsd > 0
              ? [{ key: `${p.cardId}:${i}`, projectName: p.name, label: s.label, realizedUsd: s.realized.revenueUsd }]
              : [],
          ),
        )
      : [];
  const initialCosts = costGroups.flatMap((g) => costScope.bySlug[g.slug] ?? []);
  const dashboardViews = isSopa
    ? buildFinancialDashboardViews({ groups, revenue: orgRevenue, costs: initialCosts, jobs })
    : [];

  // SOPA: one project selector filters balances + revenue together. Brand
  // portals show their single treasury + their own revenue directly.
  const overviewAndRevenue = isSopa ? (
    <SopaTreasury
      groups={groups}
      revenue={orgRevenue}
      dashboardViews={dashboardViews}
      agency={
        <SopaRevenuePanel
          initialJobs={jobs}
          canEdit={!!session}
          sharePct={SOPA_SPLIT_SHARE}
          onchainShare={onchainShare}
        />
      }
    />
  ) : (
    <>
      <TreasuryViews groups={groups} />
      {orgRevenue && orgRevenue.projects.length > 0 && <TreasuryRevenue data={orgRevenue} aggregate={false} />}
    </>
  );

  const treasuryContent = (
    <div className="space-y-8">
      {overviewAndRevenue}
      <MultisigBudgets budgets={budgets} />
      <SafeActivity safes={safes} />
      <div className="border-t border-border pt-8">
        <FixedCostsPanel
          groups={costGroups}
          initialCosts={initialCosts}
          usdBrl={costScope.usdBrl}
          canEdit={!!session}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Treasury"
        title={groups.length > 1 ? "Treasuries overview" : `${project.name} treasury`}
        description={
          groups.length > 1
            ? `The ${project.name} Safe plus every portal treasury it operates — same wallets and sources as the native apps.`
            : "The same wallets and data sources the native app shows — live balances across chains."
        }
        status={usd(combined)}
        actions={<TreasuryRefresh />}
      />
      {/* SOPA gets a "Plano financeiro" tab (the endowment study); brand portals
          just render the treasury content directly. */}
      {isSopa ? (
        <TreasuryTabs
          treasury={treasuryContent}
          members={
            <div className="space-y-10">
              {/* PAINEL — o estado ao vivo, pra qualquer membro acompanhar */}
              <div className="space-y-6">
                <div className="border-b border-border pb-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Painel ao vivo</h3>
                  <p className="mt-0.5 text-xs text-foreground-faint">Como o pagamento do time está agora — qualquer membro pode acompanhar.</p>
                </div>
                <StreamFlowView
                  members={payroll.filter((m) => m.active).map((m) => ({ label: m.label, units: m.units }))}
                  streaming={!!streamStatus && streamStatus.flowRatePerSec > 0}
                  monthlyUsd={streamStatus?.monthlyUsd ?? null}
                />
                <StreamStatus data={streamStatus} poolConfigured={!!poolAddress} portalMembers={payroll} />
                {!!poolAddress && (
                  <StreamSustainability
                    yieldMonthly={stakePosition?.monthlyYieldUsd ?? null}
                    burnMonthly={streamStatus?.monthlyUsd ?? 0}
                    bufferUsdcx={streamStatus?.safeUsdcxUsd ?? 0}
                    runwayDays={streamStatus?.runwayDays ?? null}
                    canEdit={!!session}
                  />
                )}
                {!!poolAddress && <ConnectPoolButton pool={poolAddress} forwarder={SUPERFLUID.gdaForwarder} />}
              </div>

              {/* CONFIGURAÇÃO & AÇÕES — guardar, definir o time, ligar o pagamento */}
              <div className="space-y-6">
                <div className="border-b border-border pb-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Configuração &amp; ações</h3>
                  <p className="mt-0.5 text-xs text-foreground-faint">Guardar dinheiro, definir o time e ligar o pagamento. Cada ação vira uma proposta no Safe (o time assina).</p>
                </div>
                {stakePosition && <StakingPanel position={stakePosition} canEdit={!!session} />}
                {!poolAddress && !!session && <CreatePoolButton />}
                {!!poolAddress && <StreamActions canEdit={!!session} />}
                <PayrollPanel initial={payroll} canEdit={!!session} roster={roster} />
              </div>
            </div>
          }
          plan={<FinancialPlan />}
        />
      ) : (
        treasuryContent
      )}
    </div>
  );
}
