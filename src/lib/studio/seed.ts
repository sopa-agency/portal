// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { parseScript } from "./parse-script";
import type { Carousel } from "./schema";

// Roteiro PERSPECTIVA · "O Fim do Acaso" (texto fiel ao Figma node 1:4).
export const SEED = String.raw`### [ SLIDE 1 — CAPA ]
**TÍTULO:** O FIM DO ACASO
**SUBTÍTULO:** QUANDO FOI A ÚLTIMA VEZ QUE VOCÊ ENCONTROU ALGO SEM PROCURAR?
---
### [ SLIDE 2 ]
**SUBTÍTULO:** O ALGORITMO SABE O QUE VOCÊ QUER ANTES DE VOCÊ SABER...
**TEXTO:** A gente não navega mais. A gente confirma. O feed entrega o que o histórico prometeu, o Spotify toca o que o humor já escolheu, o mapa traça o caminho mais rápido pra onde a gente já ia. Toda plataforma virou um espelho muito bem calibrado.
---
### [ SLIDE 3 ]
**SUBTÍTULO:** ISSO PARECE CONFORTO. É UMA ARMADILHA.
**TEXTO:** Conforto que vira bolha. A gente chama de personalização, mas o que acontece é filtragem. Tudo que não combina com o perfil vai sendo cortado silenciosamente. Não por censura — por eficiência. O sistema não quer te surpreender. Quer te manter dentro.
---
### [ SLIDE 4 ]
**SUBTÍTULO:** O SKATE NUNCA TEVE ALGORITMO...
**TEXTO:** O pico era descoberto a pé. Ou de ônibus, olhando pela janela. Ou porque alguém falou "cara, tem uma borda maneira na rua tal" e a gente foi sem saber o que ia encontrar. O rolê era exploração de verdade — sem mapa, sem avaliação, sem tempo estimado de chegada.
---
### [ SLIDE 5 — VIRADA ]
**SUBTÍTULO:** O ACASO NÃO ERA BUG. ERA O SISTEMA.
**TEXTO:** O encontro inesperado com a música, o livro, a pessoa, o pico — não era falha de organização. Era o mecanismo pelo qual a gente crescia. A gente se tornava mais do que o perfil que já tinha porque a vida entregava coisas fora do perfil. O algoritmo otimizou exatamente isso pra fora da equação.
---
### [ SLIDE 6 ]
**SUBTÍTULO:** A SERENDIPIDADE TEM INFRAESTRUTURA.
**TEXTO:** Não é nostalgia romantizar o acaso. É reconhecer que encontros inesperados precisam de condição pra existir: tempo não agendado, rota sem destino fixo, atenção não capturada por notificação. A gente terceirizou essas condições pro app e depois estranha não descobrir nada novo.
---
### [ SLIDE 7 ]
**SUBTÍTULO:** NENHUMA IA VAI TE RECOMENDAR O QUE VOCÊ AINDA NÃO É.
**TEXTO:** O sistema aprende quem você foi. Recomenda mais do mesmo em versão ligeiramente melhorada. Mas a transformação não vem do que já combina — vem do atrito. Da música que você não escolheria. Da conversa com quem pensa diferente. Do spot que você não tava procurando e que mudou o jeito de ver a cidade.
---
### [ SLIDE 8 ]
**SUBTÍTULO:** TEM NOME PRA ISSO.
**TEXTO:** Filter bubble não é teoria de papo acadêmico. É o que acontece quando a personalização escala. Eli Pariser lançou o termo em 2011 observando o que o Facebook fazia com o feed. Quinze anos depois, o fenômeno é infraestrutura de toda plataforma digital. A gente não percebe porque parece natural. Parece natural porque a gente parou de lembrar como era diferente.
---
### [ SLIDE 9 — TESE ]
**SUBTÍTULO:** O MAIOR PERIGO DO ALGORITMO NÃO É O QUE ELE MOSTRA.
**TEXTO:** É o que ele apaga sem avisar. Toda descoberta que não vai acontecer. Todo encontro que o sistema cortou antes de chegar. A gente não sente a falta porque não sabe o que perdeu. Mas a pessoa que você poderia ter se tornado por causa de um disco tocado por acaso — essa pessoa não vai aparecer em nenhuma recomendação.
---
### [ SLIDE 10 — CTA ]
**SUBTÍTULO:** SEGUE @REELFLIP.
**TEXTO:** A GENTE NÃO GARANTE QUE VOCÊ VAI GOSTAR DE TUDO — E É EXATAMENTE POR ISSO QUE VALE.
---
## LEGENDA
A gente não se perde mais. E tá na hora de perguntar se isso é bom.

O algoritmo não é vilão — ele só faz o que foi pedido: entregar o que a gente já quer, sem atrito, sem desvio, sem surpresa. O problema é que a gente cresceu por causa das surpresas. Por causa do acaso.

Personalização total é conforto total. E conforto total é estagnação disfarçada de eficiência.

#reelflip #perspectiva #algoritmo #skateboarding #cultura`;

// Enriquecimento fiel ao Figma 1:4: imagem de fundo + posição da caixa de texto + largura do sub-título (por card).
const ENRICH: { img: string; bloco?: { x: number; y: number; w: number }; subW?: number }[] = [
  { img: "/posts/perspectiva/01.jpg" }, // capa
  { img: "/posts/perspectiva/02.jpg", bloco: { x: 69, y: 882, w: 934 }, subW: 432 },
  { img: "/posts/perspectiva/03.jpg", bloco: { x: 67, y: 172, w: 821 }, subW: 617 },
  { img: "/posts/perspectiva/04.jpg", bloco: { x: 60, y: 956, w: 957 }, subW: 512 },
  { img: "/posts/perspectiva/05.jpg", bloco: { x: 83, y: 203, w: 913 }, subW: 581 },
  { img: "/posts/perspectiva/06.jpg", bloco: { x: 141, y: 886, w: 798 }, subW: 607 },
  { img: "/posts/perspectiva/07.jpg", bloco: { x: 91, y: 716, w: 897 }, subW: 493 },
  { img: "/posts/perspectiva/08.jpg", bloco: { x: 130, y: 869, w: 819 }, subW: 323 },
  { img: "/posts/perspectiva/09.jpg", bloco: { x: 24, y: 223, w: 1029 }, subW: 593 },
  { img: "/posts/perspectiva/10.jpg", bloco: { x: 56, y: 824, w: 484 }, subW: 281 },
];

export function buildSeed(): Carousel {
  const doc = parseScript(SEED);
  doc.cards = doc.cards.map((c, i) => {
    const e = ENRICH[i];
    if (!e) return c;
    const layout = { ...c.layout, ...(e.subW ? { subtitulo: { w: e.subW } } : {}) };
    const blocos = e.bloco && c.blocos[0] ? [{ ...c.blocos[0], ...e.bloco }, ...c.blocos.slice(1)] : c.blocos;
    return { ...c, layout, blocos, ...("imagem" in c ? { imagem: e.img } : {}) };
  });
  return doc;
}

export const SEED_DOC: Carousel = buildSeed();
