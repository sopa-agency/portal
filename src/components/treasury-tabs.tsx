"use client";

import { type ReactNode } from "react";
import { Wallet, PiggyBank, Receipt, TrendingUp, PackageOpen, type LucideIcon } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { useT } from "@/components/locale-provider";

/**
 * As abas do topo do tesouro da SOPA: quanto temos, de onde vem, o que sai,
 * quem recebe — e, por enquanto, a saída do setup antigo.
 *
 * "Pagamentos" existe porque decidir quanto cada um recebe e mandar o dinheiro
 * são a MESMA pergunta, e ela estava partida em três lugares: a urna numa rota
 * solta em /votacao, o pipeline do MOR escondido num collapsible do Tesouro, e
 * a folha em Membros. Quem ia pagar tinha que caçar as três.
 *
 * "Migração" é temporária POR DESENHO: é o que sobrou de Membros e Apoiar
 * (folha por stream, cofre da comunidade) enquanto cada um tira o que é seu.
 * Some quando a última pessoa sacar — e vive no fim justamente por isso.
 */
export function TreasuryTabs({
  treasury,
  revenue,
  costs,
  payments,
  paymentsBadge,
  migration,
}: {
  treasury: ReactNode;
  revenue?: ReactNode;
  costs?: ReactNode;
  payments?: ReactNode;
  paymentsBadge?: ReactNode;
  migration?: ReactNode;
}) {
  // Ids stay Portuguese: they are the ?tab= value, so translating them would
  // break every link anyone has already shared.
  const t = useT().treasury.tabs;
  const tabs: { id: string; label: string; icon: LucideIcon; node: ReactNode; badge?: ReactNode }[] = [
    { id: "tesouro", label: t.treasury, icon: Wallet, node: treasury },
    // Money in, then money out — the two halves of the same question, each on
    // its own tab so neither has to be scrolled past to reach the other.
    ...(revenue ? [{ id: "receita", label: t.revenue, icon: TrendingUp, node: revenue }] : []),
    ...(costs ? [{ id: "custos", label: t.costs, icon: Receipt, node: costs }] : []),
    ...(payments ? [{ id: "pagamentos", label: t.payments, icon: PiggyBank, node: payments, badge: paymentsBadge }] : []),
    ...(migration ? [{ id: "migracao", label: t.migration, icon: PackageOpen, node: migration }] : []),
  ];
  const [tab, setTab] = useUrlTab("tab", "tesouro");
  // Links já compartilhados continuam valendo: quem guardou `?tab=membros` ou
  // `?tab=apoiar` queria o conteúdo que hoje mora em Migração, e quem guardou
  // um link da urna queria Pagamentos. Cair em "tesouro" seria mandar a pessoa
  // para uma tela que não é a que ela pediu — pior do que um id desconhecido,
  // porque parece que funcionou.
  const alias: Record<string, string> = { membros: "migracao", apoiar: "migracao", votacao: "pagamentos" };
  const pedido = alias[tab] ?? tab;
  // Um `?tab=plano` guardado por alguém não quebra a página: um id que não
  // existe mais cai em "tesouro" em vez de renderizar painel nenhum.
  const active = tabs.some((t) => t.id === pedido) ? pedido : "tesouro";

  return (
    <div>
      <div className="mb-7 flex gap-1 border-b border-border" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors ${
                on ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {t.badge}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{tabs.find((t) => t.id === active)?.node}</div>
    </div>
  );
}
