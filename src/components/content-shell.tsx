"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Routes that escape the default max-w-6xl reading column and use the full
 * width of the main area (board-style pages).
 */
const FULL_BLEED_ROUTES = ["/kanban", "/about", "/org-chart", "/lab", "/zine", "/reunioes"];

/**
 * Routes that use the wide dashboard canvas (the Split Desk home design caps
 * at 1760px) instead of the reading column.
 */
const WIDE_ROUTES = ["/", "/treasury"];

/**
 * Rotas que NÃO são documento: são aplicativo dentro do portal, e tomam a
 * janela inteira — sem coluna de leitura, sem respiro, com altura exata.
 *
 * O /chat entrou aqui depois de medido: como página comum ele ganhava
 * `mx-auto max-w-6xl`, e num monitor de 1990px isso virava 291px de margem
 * morta de CADA lado, mais 40px de padding. A lista de conversas ficava
 * flutuando com buraco dos dois lados. Não era gap nem grid mal fechado — era
 * a coluna de leitura fazendo o trabalho dela numa página que não é texto.
 *
 * A altura também importa: um chat precisa da altura EXATA da janela, senão o
 * compositor cai abaixo da dobra ou sobra faixa. `min-h-screen` não serve.
 */
const APP_ROUTES = ["/chat"];

export function ContentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const wide = WIDE_ROUTES.includes(pathname);
  const app = APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  return (
    <div
      className={
        app
          ? // 3.5rem é a barra superior que só existe no mobile (a sidebar vira
            // topo abaixo de lg): ela é `h-14` em app-sidebar.tsx, e as duas
            // medidas têm que continuar iguais. No desktop a sidebar fica ao
            // lado e a janela inteira é do conteúdo.
            "h-[calc(100dvh-3.5rem)] lg:h-screen"
          : fullBleed
            ? "min-h-screen p-6 md:p-8"
            : wide
              ? "mx-auto min-h-screen max-w-[1760px] p-6 md:p-8"
              : "mx-auto min-h-screen max-w-6xl p-6 md:p-10"
      }
    >
      {children}
    </div>
  );
}
