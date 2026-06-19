export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { SetupGuide, CodeBlock } from "@/components/setup-guide";
import { TreasuryViews } from "@/components/treasury-views";
import { SafeActivity, type SafeActivityItem } from "@/components/safe-activity";
import { fetchTreasuryGroups } from "@/lib/treasury";
import { fetchSafeActivity } from "@/lib/safe-tx";
import { getActiveProject, getAllProjects } from "@/projects";
import { prisma } from "@/lib/prisma";

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
      />
      <TreasuryViews groups={groups} />
      <SafeActivity safes={safes} />
    </div>
  );
}
