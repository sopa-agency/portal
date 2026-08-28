export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { LiveBadge } from "@/components/live-badge";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { SetupGuide, CodeBlock } from "@/components/setup-guide";
import { TreasuryViews } from "@/components/treasury-views";
import { TreasuryRefresh } from "@/components/treasury-refresh";
import { SafeActivity, type SafeActivityItem } from "@/components/safe-activity";
import { MultisigBudgets, type ProjectBudget } from "@/components/multisig-budget";
import { FixedCostsPanel } from "@/components/fixed-costs-panel";
import { CostsTab } from "@/components/costs-tab";
import { TreasuryRevenue } from "@/components/treasury-revenue";
import { getOrgRevenue, type OrgRevenue } from "@/lib/org-revenue";
import { getReaderDivergence, getTreasuryHistory, getTreasuryWalletHistory, getTreasuryWalletChart } from "@/lib/treasury-history";
import { ReaderDivergencePanel } from "@/components/reader-divergence";
import { TreasuryHistoryChart } from "@/components/treasury-history-chart";
import { SopaRevenuePanel, type OnchainShare } from "@/components/sopa-revenue-panel";
import { listSopaJobs } from "@/app/actions/sopa-jobs";
import { PayrollPanel, type PayrollRosterOption } from "@/components/payroll-panel";
import { listPayrollMembers } from "@/app/actions/payroll";
import { getTeamRoster } from "@/lib/team-roster";
import { NotConfigured } from "@/components/data-state";
import { CreatePoolButton } from "@/components/create-pool-button";
import { StreamActions } from "@/components/stream-actions";
import { StreamFlowView } from "@/components/stream-flow-view";
import { StreamSustainability } from "@/components/stream-sustainability";
import { getStreamStatus, findSopaPool, SOPA_POOL_ADDRESS, SOPA_SAFE, SUPERFLUID } from "@/lib/superfluid";
import { ConnectPoolButton } from "@/components/connect-pool-button";
import { MembersTab } from "@/components/members-tab";
import { WithdrawUsdcx } from "@/components/withdraw-usdcx";
import { BrandTreasury } from "@/components/brand-treasury";
import { TreasuryAllocation } from "@/components/treasury-allocation";
import { getAllocation } from "@/app/actions/allocation";
import { StakingPanel } from "@/components/staking-panel";
import { getStakePosition, type StakePosition } from "@/lib/staking";
import { TreasuryTabs } from "@/components/treasury-tabs";
import { FinancialPlan } from "@/components/financial-plan";
import { SopaTreasury } from "@/components/sopa-treasury";
import { MorFlowDiagram } from "@/components/mor-flow-diagram";
import { MorPipelinePanel } from "@/components/mor-pipeline-panel";
import { NativeSwapDeployPanel } from "@/components/native-swap-deploy-panel";
import { SopaStakePanel } from "@/components/sopa-stake-panel";
import { getPipelineStatus } from "@/lib/mor-pipeline";
import { buildFinancialDashboardViews } from "@/lib/financial-dashboard";
import { FinancialDashboard } from "@/components/financial-dashboard";
import { TreasuryBriefingButton } from "@/components/treasury-briefing";
import { buildTreasuryBriefing } from "@/lib/treasury-briefing";
import { getSplitConfig } from "@/lib/splits";
import { VaultStaking } from "@/components/vault-staking";
import { getCommunityVaults, fetchVaultApy } from "@/lib/community-vaults";
import { VaultDepositors } from "@/components/vault-depositors";
import { VaultSupportSummary } from "@/components/vault-support-summary";
import { VaultFlowView } from "@/components/vault-flow-view";
import { getVaultDepositors, getVaultFeeAccrued } from "@/lib/vault-depositors";

import { fetchTreasuryGroups, getPrices } from "@/lib/treasury";
import { combinedTreasury, dedupeTreasuryGroups } from "@/lib/treasury-aggregate";
import { fetchSafeActivity, fetchSafeBudget } from "@/lib/safe-tx";
import { fetchCostScope } from "@/lib/fixed-costs-data";
import { getActiveProject, getAllProjects } from "@/projects";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { ChevronRight } from "lucide-react";
import { rich } from "@/components/rich-text";
import { attempt, isOk, ok, unread, type Reading } from "@/lib/reading";

export default async function TreasuryPage() {
  const project = await getActiveProject();
  const t = await getDictionary();

  if (!project.treasury) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Treasury"
          title={`${project.name} treasury`}
          description="Live balances of the project's wallets across chains."
        />
        <SetupGuide
          feature="Treasury"
          intro={t.treasury.setup.intro(project.name)}
          steps={[
            { title: t.treasury.setup.step1, body: t.treasury.setup.step1Body },
            {
              title: t.treasury.setup.step2,
              body: (
                <CodeBlock>{`// src/projects/${project.slug}.ts
treasury: {
  ethWallets: [
    { label: "Treasury Multisig", address: "0x..." },
  ],
  hiveAccounts: [
    { label: "Community account", account: "account-name" },
  ],
},`}</CodeBlock>
              ),
            },
            { title: t.treasury.setup.step3, body: t.treasury.setup.step3Body },
          ]}
        />
      </div>
    );
  }

  const groups = await fetchTreasuryGroups(project);
  const combined = combinedTreasury(groups);

  // Surface Safe transaction activity. Candidates = EVM treasury wallets (chain
  // unknown → probe Base + mainnet) plus the project's configured bounty Safes
  // (known chain). A wallet may be a Safe on either chain.
  const slugs = [project.slug, ...(project.treasury?.includeProjects ?? [])];
  // `attempt` em vez de `.catch(() => [])`: lançar JÁ é um canal — a exceção
  // carrega o motivo. O catch é que jogava fora. Lista vazia aqui afirmava
  // "não há orçamentos", que é a resposta mais legítima que esta função pode
  // dar e por isso a mentira menos suspeita das três.
  const bountyRead = await attempt(
    () => prisma.bountyConfig.findMany({ where: { projectSlug: { in: slugs } } }),
    (e) => `orçamentos não leram: ${e instanceof Error ? e.message : String(e)}`,
  );
  const bountyConfigs = isOk(bountyRead) ? bountyRead.value : [];
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
  const costGroups = dedupeTreasuryGroups(groups).map((g) => ({
    slug: g.slug,
    name: g.name,
    treasury: g.report.total,
  }));
  const isSopa = project.slug === "sopa";
  const [costScope, session, orgRevenueResult, jobsRes, history, walletHistory, walletChart] = await Promise.all([
    fetchCostScope(costGroups.map((g) => g.slug)),
    verifySession((await cookies()).get(SESSION_COOKIE)?.value, project),
    // Revenue is tracked on the org-chart. On SOPA show every project (grouped);
    // on a brand portal show only that project's own streams.
    getOrgRevenue(isSopa ? undefined : { name: project.name, slug: project.slug }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    // SOPA agency revenue: client jobs (manual).
    // Caminho COM canal: listSopaJobs devolve Result (`ok`/`error`). O catch
    // CONTORNAVA esse canal, virando null e depois `[]` — o erro aqui é bug,
    // não design, e o conserto é só parar de contornar.
    isSopa
      ? listSopaJobs().catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve(null),
    // Histórico do gráfico: leitura de banco (snapshots), zero requisição de rede.
    // Sem `.catch(() => [])`: a função já devolve Reading e engolir aqui seria
    // reintroduzir o colapso um andar acima do que acabou de ganhar canal.
    getTreasuryHistory(60, isSopa ? undefined : { name: project.name, slug: project.slug }),
    // A SOPA agrega as carteiras de todos; portal de marca vê só as suas.
    getTreasuryWalletHistory(60, isSopa ? undefined : { slug: project.slug }),
    // A Zerion NÃO é chamada no carregamento. Uma carteira é uma requisição, e
    // toda visita de todo mundo a cada TTL somava rápido contra a cota. A linha
    // abre com o snapshot do banco, que é de graça, e quem quiser a profundidade
    // da Zerion pede pelo botão de sincronizar.
    Promise.resolve({ series: [] as Awaited<ReturnType<typeof getTreasuryWalletChart>>["series"], failed: [] as string[] }),
  ]);
  // Unwrap the revenue Result: data on success, null on FAILURE — and keep a
  // distinct `revenueFailed` so the UI shows "leitura falhou", never an empty
  // org chart that reads as "SOPA has nobody".
  const orgRevenue: OrgRevenue | null = orgRevenueResult.ok ? orgRevenueResult.data : null;
  const revenueFailed = !orgRevenueResult.ok;
  // SOPA data used to be a long serial waterfall of awaits. Now two parallel waves:
  // wave 1 = everything with no cross-dependency; wave 2 = reads that need a wave-1
  // result (the pool address, and the SOPA-owned vault).
  const [payrollRes, rosterRaw, poolRead, stakeRead, allocRead, communityVaults] = await Promise.all([
    isSopa
      ? listPayrollMembers().catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve(null),
    isSopa
      ? attempt(() => getTeamRoster(project), (e) => `elenco não leu: ${e instanceof Error ? e.message : String(e)}`)
      : Promise.resolve(ok([] as Awaited<ReturnType<typeof getTeamRoster>>)),
    // A PIOR classe das três, e por isso vem antes de tudo no item 5: este
    // catch DESLIGAVA O PRÓPRIO DETECTOR. Se a descoberta do pool falhava,
    // poolAddress virava null; sem pool, o status nem era buscado; e o sinal de
    // falha era `!!poolAddress && !streamStatus`, que com poolAddress null dá
    // FALSE. A página passava a jurar que estava tudo bem porque falhou ao
    // perguntar — o dado mente e o detector confirma.
    isSopa
      ? SOPA_POOL_ADDRESS
        ? Promise.resolve(ok<string | null>(SOPA_POOL_ADDRESS))
        : attempt<string | null>(
            () => findSopaPool(),
            (e) => `pool não pôde ser descoberto: ${e instanceof Error ? e.message : String(e)}`,
          )
      : Promise.resolve(ok<string | null>(null)),
    // O null aqui fazia DOIS trabalhos: "não há posição em stake" e "não
    // consegui ler". Colapsavam com a mesma facilidade que zero colapsa com
    // desconhecido — e esta classe já mordeu de verdade (3af9642, "MOR em stake
    // sumia do saldo e lia como PERDA"). Agora a falha é `unread`; ausência de
    // posição continua sendo `ok(null)`, que é resposta legítima.
    isSopa
      ? attempt<StakePosition | null>(
          () => getStakePosition(SOPA_SAFE),
          (e) => `posição em stake não leu: ${e instanceof Error ? e.message : String(e)}`,
        )
      : Promise.resolve(ok<StakePosition | null>(null)),
    // `ok(null)` = nunca foi configurado (resposta legítima). `unread` = não
    // consegui ler, e aí a seção sumia sem dizer nada — sumir é afirmar que
    // não existe.
    isSopa
      ? attempt<Awaited<ReturnType<typeof getAllocation>> | null>(
          () => getAllocation(project.slug),
          (e) => `earmarks não leram: ${e instanceof Error ? e.message : String(e)}`,
        )
      : Promise.resolve(ok<Awaited<ReturnType<typeof getAllocation>> | null>(null)),
    isSopa
      ? attempt(() => getCommunityVaults(), (e) => `cofres não leram: ${e instanceof Error ? e.message : String(e)}`)
      : Promise.resolve(ok([] as Awaited<ReturnType<typeof getCommunityVaults>>)),
  ]);

  const jobs = jobsRes && jobsRes.ok ? jobsRes.jobs : [];
  const payroll = payrollRes && payrollRes.ok ? payrollRes.members : [];
  // Team roster → payroll member picker (auto-detect an EVM wallet in contacts).
  // Elenco que não leu vira lista vazia AQUI, mas o consumidor é um seletor de
  // pessoas: vazio ali é visivelmente estranho e não vira número em lugar
  // nenhum. O motivo fica em `rosterRaw` para quem quiser mostrar.
  const roster: PayrollRosterOption[] = isSopa && isOk(rosterRaw)
    ? rosterRaw.value.map((m) => ({
        username: m.username,
        avatarUrl: m.avatarUrl,
        address: m.contacts.find((c) => /^0x[a-fA-F0-9]{40}$/.test(c.value.trim()))?.value.trim(),
      }))
    : [];
  // Backers of the SOPA-owned vault (the one whose fee funds the payroll).
  // `ok(null)` = leu e não há posição — zero legítimo. `unread` = não se sabe,
  // e aí nem zero nem número.
  // `ok(null)` = procurou e não há pool. `unread` = a busca falhou, e aí não se
  // sabe nem se existe — estados que precisam chegar SEPARADOS até a aba.
  const allocation = isOk(allocRead) ? allocRead.value : null;
  const allocUnknown = !isOk(allocRead);
  const poolAddress = isOk(poolRead) ? poolRead.value : null;
  const poolUnknown = !isOk(poolRead);
  const stakePosition = isOk(stakeRead) ? stakeRead.value : null;
  const stakeUnknown = !isOk(stakeRead);
  const vaults = isOk(communityVaults) ? communityVaults.value : [];
  const sopaVault = vaults.find((v) => v.paysSopa) ?? null;

  // Wave 2 — depends on wave 1 (poolAddress, sopaVault); parallel with each other.
  // vaultGrossApy = the underlying Moonwell APY (the vault deploys 100% there); the
  // vault's own netApy isn't indexed by Morpho yet, so this fills the flow's $/month.
  const [streamRead, vaultDepositors, vaultGrossApy, sopaVaultEarned] = await Promise.all([
    poolAddress
      ? attempt(
          () => getStreamStatus(poolAddress),
          (e) => `status do stream não leu: ${e instanceof Error ? e.message : String(e)}`,
        )
      : Promise.resolve(ok(null)),
    sopaVault
      ? attempt(
          () => getVaultDepositors(sopaVault.vault.address),
          (e) => `apoiadores não leram: ${e instanceof Error ? e.message : String(e)}`,
        )
      : Promise.resolve(ok([] as Awaited<ReturnType<typeof getVaultDepositors>>)),
    sopaVault
      ? sopaVault.apy != null
        ? Promise.resolve(sopaVault.apy)
        : fetchVaultApy("0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca").catch(() => null)
      : Promise.resolve(null),
    // Último na ordem de gravidade — um 0 numa cifra ainda levanta suspeita,
    // enquanto [] passa por resposta legítima. Mas é dinheiro, e o briefing FALA
    // este número: "a SOPA acumulou $0 de taxa" é frase que alguém usa pra decidir.
    sopaVault
      ? attempt(
          () => getVaultFeeAccrued(sopaVault.vault.address, SOPA_SAFE),
          (e) => `taxa acumulada não leu: ${e instanceof Error ? e.message : String(e)}`,
        )
      : Promise.resolve(ok(0)),
  ]);
  // Idem ao pool: `ok(null)` é "não há pool para consultar"; `unread` é "não
  // consegui ler o status". Só a segunda é falha, e só ela acende o aviso.
  const streamStatus = isOk(streamRead) ? streamRead.value : null;
  const streamUnknown = poolUnknown || (!!poolAddress && !isOk(streamRead));
  // Agency's share of each swap split, read from the split contract itself.
  // The fee lands in a 0xSplits contract that pays SOPA and the brand treasury;
  // both halves are surfaced so the page shows the whole fee, not just our cut.
  const splitStreams =
    isSopa && orgRevenue
      ? orgRevenue.projects.flatMap((p) =>
          p.streams.flatMap((s, i) =>
            s.kind === "split" && s.realized && s.realized.revenueUsd > 0
              ? [{ key: `${p.cardId}:${i}`, projectName: p.name, label: s.label, address: s.address, chain: s.chain, realizedUsd: s.realized.revenueUsd }]
              : [],
          ),
        )
      : [];
  const onchainShare: OnchainShare[] = await Promise.all(
    splitStreams.map(async (s) => {
      const cfg = await getSplitConfig(s.address, s.chain);
      return {
        key: s.key,
        projectName: s.projectName,
        label: s.label,
        realizedUsd: s.realizedUsd,
        sopaShare: cfg?.shareFor(SOPA_SAFE) ?? null,
        recipients:
          cfg?.recipients.map((r) => ({
            address: r.address,
            share: r.share,
            label: r.address.toLowerCase() === SOPA_SAFE.toLowerCase() ? "SOPA" : s.projectName,
          })) ?? [],
      };
    }),
  );
  const initialCosts = costGroups.flatMap((g) => costScope.bySlug[g.slug] ?? []);
  // Brand portals get the same chart (their own revenue vs their own costs) —
  // they just have no agency jobs to fold in.
  const dashboardViews = buildFinancialDashboardViews({
    groups,
    revenue: orgRevenue,
    costs: initialCosts,
    jobs: isSopa ? jobs : [],
    // Série diária do snapshot, agrupada por projeto. O painel a reamostra em
    // fechamento MENSAL para dividir o eixo do tempo com as barras.
    balanceHistory: isOk(walletHistory) ? walletHistory.value : [],
  });

  // SOPA: one project selector filters balances + revenue together. Brand
  // portals show their single treasury + their own revenue directly.
  // Leitura de banco, sem rede — o custo da comparação foi pago no cron.
  const divergence = isSopa ? await getReaderDivergence() : null;

  const pipelineRead = isSopa
    ? await attempt<Awaited<ReturnType<typeof getPipelineStatus>> | null>(
        () => getPipelineStatus(),
        (e) => `pipeline MOR não leu: ${e instanceof Error ? e.message : String(e)}`,
      )
    : ok<Awaited<ReturnType<typeof getPipelineStatus>> | null>(null);
  const pipelineStatus = isOk(pipelineRead) ? pipelineRead.value : null;

  // Two halves of the same component, one per tab: they share the project
  // filter, which is why they aren't two components.
  const sopaOverview = isSopa ? (
    <SopaTreasury
      part="treasury"
      groups={groups}
      revenue={orgRevenue}
      revenueError={revenueFailed}
      dashboardViews={dashboardViews}
      agency={null}
    />
  ) : null;

  const sopaRevenue = isSopa ? (
    <SopaTreasury
      part="revenue"
      groups={groups}
      revenue={orgRevenue}
      revenueError={revenueFailed}
      dashboardViews={dashboardViews}
      agency={
        <SopaRevenuePanel
          initialJobs={jobs}
          canEdit={!!session}
          onchainShare={onchainShare}
        />
      }
    />
  ) : null;

  // Brand portal (Gnars, SkateHive…): no stake/stream payroll, so the treasury
  // reads as "quanto temos → está saudável? → de onde vem → onde está → o que sai".
  const brandView = groups.find((g) => g.slug === project.slug) ?? groups[0];
  const brandBurn = initialCosts.filter((c) => c.active).reduce((s, c) => s + c.monthlyUsd, 0);

  // SOPA's own pot, as a reading — the earmark panel's denominator.
  const ownTotal: Reading<number> =
    groups.find((g) => g.slug === project.slug)?.report.total ?? unread("tesouro da SOPA não encontrado");

  const treasuryContent = isSopa ? (
    <div className="space-y-6">
      {/* O gráfico abre a visão: a primeira pergunta é "para onde isto está
          indo", antes da composição de hoje. Fica FORA do SopaTreasury porque
          aquele componente recebe receita como dado, não como nó — foi por isso
          que o gráfico não aparecia aqui na primeira subida. */}
      <TreasuryHistoryChart
        wallets={walletChart.series.length ? ok(walletChart.series) : walletHistory}
        streams={history}
        failed={walletChart.failed}
      />
      {/* Esta aba responde UMA pergunta: quanto temos e onde está. De onde vem
          (receita) e o que sai (custos) são perguntas próprias, cada uma na sua
          aba — empilhar as três aqui obrigava a rolar por duas para chegar na
          terceira, e nenhuma delas ficava sendo o assunto da tela. */}
      {sopaOverview}
      {/* Operações MOR (pipeline + stake) — ferramentas de owner, recolhidas num
          collapsible pra Tesouro ficar uma visão limpa de "quanto temos". */}
      <details className="group border-t border-border pt-8">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground-muted transition-colors hover:text-foreground">
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
          {t.treasury.ops.mor}
          <span className="text-xs font-normal text-foreground-faint">{t.treasury.ops.morHint}</span>
        </summary>
        <div className="mt-5 space-y-6">
          {!isOk(pipelineRead) && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              ⚠ O pipeline MOR não pôde ser lido
              {pipelineRead.state === "unread" ? ` — ${pipelineRead.reason}` : ""}. O painel abaixo está ausente por
              isso, não porque não haja pipeline.
            </p>
          )}
          {pipelineStatus && <MorPipelinePanel initial={pipelineStatus} />}
          {divergence && <ReaderDivergencePanel data={divergence} />}
          {/* TEMP: deploy + dry-run the native-swap flash filler (haxixe only). Delete after wiring the real Swap A/B buttons. */}
          <NativeSwapDeployPanel />
          <SopaStakePanel />
          {/* O didático mora junto da coisa que ele explica, não na tela de
              consulta. Vem por último: quem abriu "Operar" quer a ferramenta;
              a explicação fica embaixo, para quem precisa dela. */}
          <MorFlowDiagram />
        </div>
      </details>
      {/* Earmarks are PERCENTAGES OF the pot, so an incomplete pot makes every
          slice wrong in a way that still looks plausible. The panel is withheld
          rather than shown with a denominator we couldn't finish reading. */}
      {/* Earmarks nunca configurados é resposta legítima e some em silêncio de
          propósito. Earmarks que NÃO LERAM é outra coisa, e precisa dizer. */}
      {allocUnknown && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          ⚠ Os earmarks não puderam ser lidos
          {!isOk(allocRead) && allocRead.state === "unread" ? ` — ${allocRead.reason}` : ""}. Isto NÃO quer dizer que
          não haja destinação definida.
        </p>
      )}
      {allocation && ownTotal.state !== "ok" && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t.treasury.hero.incomplete} — {ownTotal.state === "unread" ? ownTotal.reason : ownTotal.note}
        </p>
      )}
      {allocation && isOk(ownTotal) && (
        <TreasuryAllocation
          initial={allocation}
          // SOPA's OWN pot and SOPA's OWN costs — not the brand treasuries it
          // merely reports on (those are separate money, own multisigs).
          totalUsd={ownTotal.value}
          // Posição desconhecida não entra como 0 num painel de porcentagens:
          // o earmark ficaria dividindo por um bolo que ninguém leu.
          stakedUsd={stakeUnknown ? null : stakePosition?.valueUsd ?? 0}
          canEdit={!!session}
          streamMonthlyUsd={streamStatus?.monthlyUsd ?? 0}
          apy={stakePosition?.apy ?? null}
          monthlyCostsUsd={initialCosts
            .filter((c) => c.active && c.projectSlug === project.slug)
            .reduce((s, c) => s + c.monthlyUsd, 0)}
        />
      )}
      {(budgets.length > 0 || safes.length > 0) && (
        <details className="group border-t border-border pt-8">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground-muted transition-colors hover:text-foreground">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
            {t.treasury.ops.multisig}
            <span className="text-xs font-normal text-foreground-faint">{t.treasury.ops.multisigHint}</span>
          </summary>
          <div className="mt-5 space-y-6">
            <MultisigBudgets budgets={budgets} />
            <SafeActivity safes={safes} />
          </div>
        </details>
      )}
    </div>
  ) : (
    <div className="space-y-6">
      <BrandTreasury
        group={brandView}
        monthlyBurnUsd={brandBurn}
        dashboard={
          dashboardViews.some((v) => v.slug === project.slug) ? (
            <FinancialDashboard views={dashboardViews} selectedView={project.slug} />
          ) : null
        }
        revenue={
          <>
            <TreasuryHistoryChart wallets={walletChart.series.length ? ok(walletChart.series) : walletHistory} streams={history} failed={walletChart.failed} />
            <div className="mt-4" />
            {revenueFailed ? (
              <p className="text-xs text-warning">⚠ receita não carregou (leitura falhou) — não é zero</p>
            ) : orgRevenue && orgRevenue.projects.length > 0 ? (
              <TreasuryRevenue data={orgRevenue} aggregate={false} />
            ) : null}
          </>
        }
        balances={<TreasuryViews groups={groups} hideTotal />}
        costs={
          <FixedCostsPanel
            groups={costGroups}
            initialCosts={initialCosts}
            usdBrl={costScope.usdBrl}
            canEdit={!!session}
          />
        }
      />
      <MultisigBudgets budgets={budgets} />
      <SafeActivity safes={safes} />
    </div>
  );

  // The page in prose. Same live values the cards render, said out loud so the
  // state is readable in half a minute.
  const ownGroup = groups.find((g) => g.slug === project.slug) ?? groups[0];
  const ownView = dashboardViews.find((v) => v.slug === project.slug);
  const last6 = (ownView ?? dashboardViews[0])?.series.slice(-6) ?? [];
  const briefing = buildTreasuryBriefing({
    projectName: project.name,
    // null, never 0: the briefing speaks the number aloud, and "zero in cash"
    // is a sentence someone acts on.
    ownTreasuryUsd: ownGroup && isOk(ownGroup.report.total) ? ownGroup.report.total.value : null,
    combinedTreasuryUsd: isOk(combined) ? combined.value : null,
    brandCount: Math.max(0, groups.length - 1),
    stakedUsd: stakePosition?.valueUsd ?? null,
    apy: stakePosition?.apy ?? null,
    monthlyYieldUsd: stakePosition?.monthlyYieldUsd ?? null,
    harvestableUsd: stakePosition?.harvestableUsd ?? null,
    streamMonthlyUsd: streamStatus ? streamStatus.monthlyUsd : null,
    streamBufferUsd: streamStatus?.safeUsdcxUsd ?? 0,
    streamRunwayDays: streamStatus?.runwayDays ?? null,
    memberCount: payroll.filter((m) => m.active).length,
    connectedCount: streamStatus?.members.filter((m) => m.connected).length ?? 0,
    ownMonthlyCostsUsd: initialCosts
      .filter((c) => c.active && c.projectSlug === project.slug)
      .reduce((s, c) => s + c.monthlyUsd, 0),
    allMonthlyCostsUsd: initialCosts.filter((c) => c.active).reduce((s, c) => s + c.monthlyUsd, 0),
    incomingLast6Usd: last6.reduce((s, p) => s + p.incomingUsd, 0),
    jobsLast6Usd: last6.reduce((s, p) => s + p.jobsUsd, 0),
    pendingJobsUsd: ownView?.pendingJobsUsd ?? 0,
    queued: safes
      .flatMap((s) => s.activity.queued)
      .sort((a, b) => a.nonce - b.nonce)
      .map((q) => ({ nonce: q.nonce, action: q.action, confirmations: q.confirmations, required: q.required })),
    allocationSaved: allocation?.saved ?? true,
    // O briefing DIZ estes números em voz alta. Apoiadores que não leram viravam
    // "0 apoiadores, $0 depositados" — a forma mais grave das três: afirmação
    // positiva sobre pessoas e sobre dinheiro, a partir de leitura que não houve.
    // Sem leitura, o bloco inteiro do cofre simplesmente não é afirmado.
    vault: sopaVault && isOk(vaultDepositors) && isOk(sopaVaultEarned)
      ? (() => {
          const backers = vaultDepositors.value.filter((d) => !d.isDeadDeposit && d.assets > 0);
          return {
            depositedUsd: backers.reduce((s, d) => s + d.assets, 0),
            backers: backers.length,
            // A depositor with a resolved label is a known payroll member.
            teamBackers: backers.filter((d) => d.label != null).length,
            sopaEarnedUsd: sopaVaultEarned.value,
            apy: vaultGrossApy,
            feeToSopa: sopaVault.fee,
          };
        })()
      : undefined,
    // SOPA's MOR position (Morpheus/Gnars subnet) — only when the pipeline read
    // succeeded (SOPA-only). Same live numbers the pipeline + stake panels show.
    mor: pipelineStatus
      ? {
          stakedMor: pipelineStatus.sopaStakedMor,
          walletMor: pipelineStatus.sopaWalletMor,
          pendingMor: pipelineStatus.sopaWarehouseMor,
          subnetPendingMor: pipelineStatus.subnetRewardMor,
        }
      : undefined,
  }, await getLocale());

  return (
    <div className="space-y-6">
      {/* The project name is the eyebrow and "Tesouraria" the title — it used to
          be the other way round, which said the word twice. The status slot no
          longer repeats the total either: the hero card below shows it in full
          size, so this one carries the live signal instead. */}
      <PageHeader
        eyebrow={project.name}
        title={groups.length > 1 ? t.treasury.titleMulti : t.treasury.title}
        description={
          groups.length > 1 ? t.treasury.descriptionMulti(project.name) : t.treasury.description
        }
        status={<LiveBadge label={t.treasury.live} title={t.treasury.liveTitle} />}
        actions={
          <div className="flex items-center gap-2">
            <TreasuryBriefingButton briefing={briefing} />
            <TreasuryRefresh />
          </div>
        }
      />
      {/* SOPA gets a "Plano financeiro" tab (the endowment study); brand portals
          just render the treasury content directly. */}
      {isSopa ? (
        <TreasuryTabs
          treasury={treasuryContent}
          revenue={sopaRevenue}
          costs={
            <CostsTab groups={costGroups} initialCosts={initialCosts} usdBrl={costScope.usdBrl} canEdit={!!session} />
          }
          members={
            <MembersTab
              canEdit={!!session}
              members={payroll
                .filter((m) => m.active)
                .map((m) => {
                  const chain = streamStatus?.members.find((sm) => sm.address.toLowerCase() === m.address.toLowerCase());
                  return {
                    label: m.label,
                    address: m.address,
                    units: m.units,
                    // `chain` ausente = a leitura do pool falhou. Antes isso
                    // virava `false` e dois zeros, afirmando o estado da folha
                    // de cada pessoa a partir de uma leitura que não houve.
                    connected: chain ? chain.connected : null,
                    receivedUsd: chain ? chain.receivedUsd : null,
                    claimedUsd: chain ? chain.claimedUsd : null,
                  };
                })}
              monthlyUsd={streamStatus?.monthlyUsd ?? null}
              streaming={!!streamStatus && streamStatus.flowRatePerSec > 0}
              runwayDays={streamStatus?.runwayDays ?? null}
              bufferUsd={streamStatus?.safeUsdcxUsd ?? 0}
              // O detector deixa de depender do que ele detecta: pool que não
              // pôde ser DESCOBERTO agora acende o aviso, em vez de apagá-lo.
              streamFailed={streamUnknown}
              flow={
                <>
                  <StreamFlowView
                    members={payroll.filter((m) => m.active).map((m) => ({ label: m.label, units: m.units }))}
                    streaming={!!streamStatus && streamStatus.flowRatePerSec > 0}
                    monthlyUsd={streamStatus?.monthlyUsd ?? null}
                  />
                  {!poolAddress && (
                    <NotConfigured>
                      {rich(t.treasury.pool.missing)}
                      {t.treasury.pool.missingBody}
                    </NotConfigured>
                  )}
                </>
              }
              sustainability={
                poolAddress ? (
                  <StreamSustainability
                    failed={!streamStatus}
                    yieldMonthly={stakePosition?.monthlyYieldUsd ?? null}
                    burnMonthly={streamStatus?.monthlyUsd ?? 0}
                    bufferUsdcx={streamStatus?.safeUsdcxUsd ?? 0}
                    runwayDays={streamStatus?.runwayDays ?? null}
                  />
                ) : null
              }
              withdraw={<WithdrawUsdcx />}
              connect={
                poolAddress ? (
                  <ConnectPoolButton
                    pool={poolAddress}
                    forwarder={SUPERFLUID.gdaForwarder}
                    connectedAddresses={(streamStatus?.members ?? []).filter((m) => m.connected).map((m) => m.address.toLowerCase())}
                  />
                ) : null
              }
              steps={[
                ...(stakePosition
                  ? [{ title: t.treasury.members.stepStake, node: <StakingPanel position={stakePosition} canEdit={!!session} /> }]
                  : []),
                ...(!poolAddress && session ? [{ title: t.treasury.members.stepCreatePool, node: <CreatePoolButton /> }] : []),
                { title: t.treasury.members.stepTeam, node: <PayrollPanel initial={payroll} canEdit={!!session} roster={roster} /> },
                ...(poolAddress
                  ? [
                      {
                        title: t.treasury.members.stepTurnOn,
                        node: (
                          <StreamActions
                            canEdit={!!session}
                            yieldMonthly={stakePosition?.monthlyYieldUsd ?? null}
                            bufferUsd={streamStatus?.safeUsdcxUsd ?? 0}
                            harvestableUsd={stakePosition?.harvestableUsd ?? null}
                            currentFlowMonthly={streamStatus?.monthlyUsd ?? 0}
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          }
          apoiar={
            // Cofres que não leram NÃO somem da tela. Sumir é afirmar que não
            // existem — e uma aba inteira que desaparece em silêncio é a
            // omissão mais difícil de notar que existe.
            !isOk(communityVaults) ? (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                ⚠ Os cofres da comunidade não puderam ser lidos
                {communityVaults.state === "unread" ? ` — ${communityVaults.reason}` : ""}. Isto NÃO quer dizer que
                não há cofre.
              </p>
            ) : vaults.length > 0 ? (
              <div className="space-y-6">
                {!isOk(vaultDepositors) && (
                  <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    ⚠ Os apoiadores não puderam ser lidos
                    {vaultDepositors.state === "unread" ? ` — ${vaultDepositors.reason}` : ""}. Os totais abaixo
                    ficam de fora — zero apoiadores seria afirmação, não leitura.
                  </p>
                )}
                {sopaVault && isOk(vaultDepositors) && isOk(sopaVaultEarned) && (
                  <VaultSupportSummary
                    depositedUsd={vaultDepositors.value.filter((d) => !d.isDeadDeposit).reduce((s, d) => s + d.assets, 0)}
                    apy={sopaVault.apy}
                    liveYieldUsd={sopaVaultEarned.value + vaultDepositors.value.reduce((s, d) => s + d.earned, 0)}
                    sopaEarnedUsd={sopaVaultEarned.value}
                    feeToSopa={sopaVault.fee}
                  />
                )}
                {/* The yield flow is a wide horizontal diagram — it reads best at
                    full width, so everything stacks rather than sitting half-width. */}
                <VaultStaking vaults={vaults} />
                {sopaVault && isOk(vaultDepositors) && isOk(sopaVaultEarned) && (
                  <>
                    <VaultFlowView depositors={vaultDepositors.value} apy={vaultGrossApy} feeToSopa={sopaVault.fee} sopaEarned={sopaVaultEarned.value} />
                    <VaultDepositors depositors={vaultDepositors.value} apy={sopaVault.apy} feeToSopa={sopaVault.fee} />
                  </>
                )}
              </div>
            ) : undefined
          }
          plan={
            <div className="space-y-6">
              <FinancialPlan
                liveStakedUsd={stakePosition?.valueUsd ?? 0}
                liveApy={stakePosition?.apy ?? null}
                monthlyCostsUsd={initialCosts
                  .filter((c) => c.active && c.projectSlug === project.slug)
                  .reduce((s, c) => s + c.monthlyUsd, 0)}
                streamMonthlyUsd={streamStatus?.monthlyUsd ?? 0}
              />
            </div>
          }
        />
      ) : (
        treasuryContent
      )}
    </div>
  );
}
