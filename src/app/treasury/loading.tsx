"use client";

import { PageHeader } from "@/components/page-header";
import { useT } from "@/components/locale-provider";

/**
 * O que aparece enquanto o servidor monta a tesouraria.
 *
 * POR QUE ISTO EXISTE (e por que quase foi deletado)
 *
 * Eu tinha removido este arquivo, achando que o esqueleto é que fazia a página
 * "parecer que demora mais". Medido, o efeito foi o oposto e foi brutal: sem um
 * `loading`, a rota não tem fronteira de streaming e o navegador fica em BRANCO
 * até o servidor terminar tudo — o primeiro byte foi de 2,4s para 25s. O
 * esqueleto não era o problema; ele era o que segurava a percepção de pé.
 *
 * O problema era o esqueleto ser um bloco cinza do tamanho da tela, que não diz
 * nada além de "espere". Então ele passa a mostrar a ESTRUTURA REAL — o título,
 * a explicação e as abas, que são texto estático e não dependem de leitura
 * nenhuma — e reserva silêncio só onde os números de fato vão entrar.
 *
 * O texto é o mesmo do cabeçalho de verdade, de propósito: assim a troca do
 * esqueleto pela página não move nada de lugar.
 *
 * É CLIENT COMPONENT por necessidade, não por gosto: `getDictionary()` é async,
 * e um fallback de Suspense que suspende não é fallback — anularia a fronteira
 * de streaming que este arquivo existe para criar. `useT()` resolve o idioma de
 * forma síncrona, a partir do provider que já envolve a rota.
 */
export default function Loading() {
  const t = useT().treasury;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="SOPA" title={t.title} description={t.description} />

      {/* As abas existem e são clicáveis assim que a página chega; mostrá-las
          agora evita o pulo de layout que um bloco só provocaria. */}
      <div className="flex flex-wrap gap-1.5">
        {[t.tabs.treasury, t.tabs.revenue, t.tabs.costs, t.tabs.members, t.tabs.support].map((n) => (
          <span
            key={n}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground-faint"
          >
            {n}
          </span>
        ))}
      </div>

      {/* Só aqui há espera de verdade: a curva e os números. Sem texto
          inventado — um "carregando…" a mais não acelera nada e só ocupa a
          linha onde o número vai aparecer. */}
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="h-[420px] animate-pulse rounded-2xl border border-border bg-surface lg:col-span-7" />
        <div className="space-y-3 lg:col-span-5">
          <div className="h-28 animate-pulse rounded-2xl border border-border bg-surface" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />
            <div className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />
          </div>
        </div>
      </div>
    </div>
  );
}
