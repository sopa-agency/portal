# SOPA Treasury Page — Re-Execution Plan

> Planejado pelo agente Fable a partir de uma leitura completa de `src/app/treasury/page.tsx`,
> seus ~25 componentes e as 6 libs de dados. Este doc guia um refactor **em fases**, cada uma
> shippável sozinha. A branch é `refactor/treasury-replan`.
>
> **Já feito e em `main`** (fora do escopo das fases): (1) paralelização das leituras on-chain
> no `page.tsx` (waterfall → 2 ondas); (2) régua de runway sem stream não pinta mais barra verde
> cheia; (3) o cofre USDC ocupa a largura toda na aba Apoiar.

## Objetivos da página
1. **Tesouro** — quanto SOPA (e as marcas que opera) tem, ao vivo, multi-chain; se é saudável (runway vs custos fixos); onde está; de onde vem (jobs de agência + splits on-chain).
2. **Membros (payroll)** — stream Superfluid GDA (USDCx, Base) pro time, idealmente bancado pelo rendimento do stake (Morpho). Quem recebe o quê, se está fluindo, se é sustentável (rendimento ≥ gasto?), quanto dura a reserva. Toda ação de dinheiro é **proposta no multisig** (HITL).
3. **Apoiar** — comunidade deposita USDC num cofre Moonwell (ERC-4626, não-custodial); 50% da taxa de rendimento banca o payroll.
4. **Plano** — estudo de endowment: o rendimento sustenta o payroll pra sempre?

Dois públicos dividem as abas: **viewer** ("o que está acontecendo, em palavras") e **admin/signer** ("o que posso fazer, passo a passo"). Copy em português-claro pra não-cripto.

## A. Arquitetura de informação
- **Mantém 4 abas.** O problema não é a quantidade — é que só Membros tem IA interna (Painel vs Controles). Aplicar o *princípio* (viewer primeiro, ação de admin separada) por aba, sem copiar o formato literal onde não cabe.
- **Tesouro**: reordenar (hoje mostra "pra que é o dinheiro" antes de dizer quanto existe). Ordem alvo: **quanto temos → onde está → de onde vem → pra que é → o que sai → atividade do multisig (recolhida)**. Sem sub-aba; só esconder botões de edição atrás de `canEdit`. Recolher `MultisigBudgets`+`SafeActivity` num disclosure.
- **Membros**: manter Painel/Controles como está (melhor padrão do código).
- **Apoiar**: sem split viewer/admin (depósito é o supporter na própria carteira). Reordenar: aviso "não é cofre da SOPA" **acima** do pitch.
- **Plano**: leitura pura + progressive disclosure.
- **Brand portals** (Gnars/SkateHive): mesmo route, view só-tesouro (sem stream/stake/vault/plano). Extrair `<TreasuryHealthHero>` (hoje duplicado em `sopa-treasury` e `brand-treasury`).

## B. Padrão de código
- **`src/lib/format.ts`** — `usd` / `usdWhole` / `usdTiny` / `pct` + `formatRunwayDays`/`daysTone` e `formatRunwayMonths`/`monthsTone` (dias e meses são funções **separadas** — impossível trocar a banda de um pela do outro). Substitui ~20 `usd()` locais divergentes.
- **`src/lib/chart-colors.ts`** — `SERIES_PALETTE`/`chartColorAt` (dedup de 5 cópias da paleta).
- **`src/components/data-state.tsx`** — `DataState<T>` = loading | not-configured | error | ok (0 é valor válido em `ok`). Primitivas `NotConfigured` / `ReadFailed` / `LoadingDots`. Acaba com a dupla personalidade: cofre honesto vs `.catch(() => 0)` mentiroso.
- **Fetch**: `page.tsx` é `force-dynamic`; o cache real é o `next.revalidate` por fonte (balances/prices ~300–600s, stream/stake ~60s). Ações mutadoras devem disparar refresh (padrão de referência: `vault-staking` com `router.refresh()`).
- **Contrato de erro** — pontos de falha concretos: `staking.ts` retorna `valueUsd: 0` no catch (mentira indistinguível de zero real, alimenta allocation + sustentabilidade); `getStreamStatus` colapsa "sem pool" e "leitura falhou" no mesmo `null`; ~9 `.catch(()=>0/[]/null)` no `page.tsx`.
- **Tokens/a11y**: 29 `dark:` hardcodes (maioria emerald→`text-success`, mecânico); `bg-black/10` viola AGENTS.md; tooltips só-`title`; inputs sem `<label>`; pill selectors sem `aria-pressed`.
- **Tamanho**: `fixed-costs-panel.tsx` (796 linhas) e `financial-plan.tsx` (532) fogem do padrão ~100–400 → quebrar.

## C. Bugs/segurança achados (além do review inicial)
1. **Delete sem confirmação** em `payroll-panel.tsx` e `sopa-revenue-panel.tsx` — clique errado apaga membro/receita pra sempre. `fixed-costs-panel` já usa `useConfirm()`. **[urgente]**
2. **Dois thresholds de runway-meses pra mesma métrica na mesma aba** (`fixed-costs-panel` <6/<12 vs `health()` <3/<12).
3. Sparkline **falso** de alta ao lado de um APY real (implica histórico que não existe).

## D. Fases
- **Fase 0 — Fundação**: `format.ts`, `chart-colors.ts`, `data-state.tsx`; troca os `usd()`/paletas; emerald→`text-success`; remove sparkline; corrige `bg-black`. *(behavior visível: total do header passa a mostrar centavos abaixo de $100 → usar `usdWhole` nos heróis pra manter inteiro.)*
- **Fase 1 — Contrato de erro** (libs): `staking.ts`, `superfluid.ts`, `page.tsx` (sites com $ primeiro), `members-tab`/`stream-sustainability`. *Depende do fix de paralelização (já em main).*
- **Fase 2 — Membros**: apaga `stream-status.tsx`, `daysTone`, labels nos inputs, confirm no delete.
- **Fase 3 — Apoiar**: reordena aviso, adota `DataState`.
- **Fase 4 — Tesouro**: 4a extrai hero + reordena + recolhe multisig; 4b quebra `fixed-costs-panel` + reconcilia bandas **[decisão: 3/12 ou 6/12]**; 4c confirm + aria.
- **Fase 5 — Plano**: tokens + progressive disclosure **[sign-off nos cortes]**.
- **Fase 6 — Polimento**: primitiva `<Hint>`, pasta `treasury/`.

## E. Manter intocado
Painel/Controles + steps numerados · guard honesto do VaultCard · cofre não-custodial · veredito-em-palavras-antes-do-número · tokens `--viz-*` da allocation · `useUrlTab` · `useConfirm` · `TreasuryBriefing`.
