"use client";

import { type ReactNode } from "react";
import { Wallet, PiggyBank, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
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
 * "Migração" existiu para isso e foi embora quando cumpriu: era o que sobrara
 * de Membros e Apoiar (folha por stream, cofre da comunidade) enquanto cada um
 * tirava o que era seu. Saiu em 09/09/2026, com o cofre sem dinheiro de
 * terceiro e o stream desligado.
 */
export function TreasuryTabs({
  treasury,
  revenue,
  costs,
  payments,
  paymentsBadge,
}: {
  treasury: ReactNode;
  revenue?: ReactNode;
  costs?: ReactNode;
  payments?: ReactNode;
  paymentsBadge?: ReactNode;
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
  ];
  const [tab, setTab] = useUrlTab("tab", "tesouro");
  // Um link guardado da urna continua valendo: quem salvou `?tab=votacao`
  // queria Pagamentos. Já `membros`, `apoiar` e `migracao` apontavam para uma
  // aba que não existe mais, e caem em "tesouro" — a página abre, só não na
  // tela pedida. Melhor que um 404 de aba, e a tela que eles pediam não tem
  // mais conteúdo para mostrar.
  const alias: Record<string, string> = { votacao: "pagamentos" };
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
