export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { SetupGuide, CodeBlock } from "@/components/setup-guide";
import { TreasuryViews } from "@/components/treasury-views";
import { fetchTreasuryGroups } from "@/lib/treasury";
import { getActiveProject } from "@/projects";

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
    </div>
  );
}
