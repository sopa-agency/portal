import type { TreasurySeries } from "@/lib/treasury-history";

// Reconciliar a série da Zerion com o saldo que a gente mede.
//
// O PROBLEMA, medido e não suposto
//
// A Zerion tem 361 dias de histórico; o snapshot do portal tem os dias desde
// que o cron começou. Só que o endpoint /charts/ da Zerion NÃO conta posição de
// protocolo — o `filter[positions]=no_filter` funciona em /positions/ e é
// ignorado ali. Então, no dia em que a SkateHive stakou stETH na Morpheus, a
// série da Zerion despencou: para ela, o dinheiro sumiu da carteira. Não sumiu,
// mudou de bolso.
//
// A tela vinha resolvendo isso com um aviso amarelo, com os números escritos à
// mão dentro do texto. Aviso não conserta gráfico: a linha continuava dizendo
// que o tesouro caiu, e "caiu" é a leitura que fica na cabeça de quem olha.
//
// A CORREÇÃO
//
// O buraco tem tamanho conhecido. O snapshot do portal lê a carteira INTEIRA,
// posição de protocolo incluída, e o último ponto dele é o total verdadeiro de
// hoje. A diferença entre esse total e o último ponto da Zerion é exatamente o
// que está em stake:
//
//     buraco = totalVerdadeiroHoje − últimoPontoDaZerion
//
// E esse buraco não existia antes do stake — antes, o dinheiro estava líquido e
// a Zerion o via. Ou seja: a série tem um DEGRAU, de tamanho ≈ buraco, no dia
// do stake. Achando o degrau, somar o buraco dali para a frente devolve a linha
// contínua e verdadeira dos dois lados.
//
// POR QUE ISSO NÃO É CHUTE
//
// Nada aqui é inventado. O TAMANHO vem de uma medição independente (a leitura
// da carteira, que conta protocolo); o LUGAR vem da própria série, do dia em
// que ela deu um salto que nenhum movimento de preço explica (ver a regra
// abaixo). Se as duas coisas não casarem, a função NÃO corrige e diz por quê —
// porque uma correção que erra o lugar do degrau é pior que a série torta: ela
// mente com aparência de conserto.
//
// A confusão possível — uma retirada de verdade do mesmo tamanho — é descartada
// pela própria evidência: se o dinheiro tivesse saído, o total de hoje (que
// conta protocolo) também estaria baixo, e não haveria buraco nenhum para casar.

// COMO O DEGRAU É RECONHECIDO — e por que não é por igualdade.
//
// A primeira versão exigia que a queda batesse com o buraco de hoje (±25%). Na
// prática ela não corrigiu nada, e o motivo é óbvio depois de medido: na
// SkateHive a queda foi de US$ 2.454 em 23/08 e o buraco hoje é US$ 1.909. Não
// é erro — é que o ativo ficou dois meses em stake e mudou de preço. Exigir
// igualdade entre um evento do passado e um saldo do presente é exigir que o
// mercado tenha ficado parado.
//
// O que de fato identifica o dia do stake nos dados é ser um OUTLIER: US$ 2.454
// contra US$ 121 da segunda maior queda — vinte vezes. Movimento de preço não
// faz isso; sair da carteira faz.
//
// Então são três testes, e os três precisam passar:
//   1. a queda DOMINA as outras (≥ 3× a segunda maior) — é evento estrutural,
//      não volatilidade;
//   2. é da MESMA ORDEM do buraco (entre metade e o dobro) — o que sobrou de
//      folga é preço, e preço anda;
//   3. o buraco é GRANDE perto do tesouro (≥ 15%) — abaixo disso é posição
//      pequena que cresce devagar, não tem degrau nenhum para achar, e avisar
//      sobre ela seria ruído.

/** A queda tem que ser este tanto maior que a segunda maior. */
const DOMINANCIA_MIN = 3;
/** E ficar nesta faixa em relação ao buraco de hoje. */
const RAZAO_MIN = 0.5;
const RAZAO_MAX = 2;
/** Abaixo disto o buraco é poeira de preço, não stake: não mexe. */
const BURACO_MIN_USD = 1;
/** E também precisa ser relevante perto do próprio tesouro. */
const BURACO_MIN_FRACAO = 0.15;

export type Reconciliacao = {
  series: TreasurySeries[];
  /** Tesouros cuja série foi corrigida, com o tamanho do degrau. */
  corrigidos: { label: string; usd: number }[];
  /**
   * Tesouros em que há buraco mas o degrau NÃO foi localizado — a série deles
   * segue torta e a tela precisa dizer isso. Silenciar aqui recriaria o bug
   * original numa roupa nova.
   */
  naoCorrigidos: { label: string; usd: number }[];
};

/**
 * @param zerion  A série da Zerion (fundo histórico, sem posição de protocolo).
 * @param verdade A série do snapshot do portal (curta, porém completa) — é dela
 *                que sai o total verdadeiro de hoje, por tesouro.
 */
export function reconcileWithTruth(zerion: TreasurySeries[], verdade: TreasurySeries[]): Reconciliacao {
  const totalHoje = new Map<string, number>();
  for (const s of verdade) {
    const ultimo = s.points[s.points.length - 1];
    if (ultimo) totalHoje.set(s.cardId, ultimo.usd);
  }

  const corrigidos: Reconciliacao["corrigidos"] = [];
  const naoCorrigidos: Reconciliacao["naoCorrigidos"] = [];

  const series = zerion.map((s) => {
    const verdadeiro = totalHoje.get(s.cardId);
    const ultimo = s.points[s.points.length - 1];
    if (verdadeiro == null || !ultimo || s.points.length < 3) return s;

    const buraco = verdadeiro - ultimo.usd;
    // Buraco negativo (a Zerion acima do nosso total) é outro assunto — preço
    // diferente, token que a gente não precifica — e não é isto que conserta.
    if (buraco < BURACO_MIN_USD || buraco < verdadeiro * BURACO_MIN_FRACAO) return s;

    // O degrau: a maior queda de um dia para o outro, e a segunda maior — que é
    // a régua contra a qual se mede se a primeira é mesmo um evento.
    let iDegrau = -1;
    let maiorQueda = 0;
    let segundaQueda = 0;
    for (let i = 1; i < s.points.length; i++) {
      const queda = s.points[i - 1].usd - s.points[i].usd;
      if (queda > maiorQueda) {
        segundaQueda = maiorQueda;
        maiorQueda = queda;
        iDegrau = i;
      } else if (queda > segundaQueda) {
        segundaQueda = queda;
      }
    }

    const razao = maiorQueda / buraco;
    const casa =
      iDegrau > 0 &&
      maiorQueda >= segundaQueda * DOMINANCIA_MIN &&
      razao >= RAZAO_MIN &&
      razao <= RAZAO_MAX;
    if (!casa) {
      naoCorrigidos.push({ label: s.label, usd: buraco });
      return s;
    }

    corrigidos.push({ label: s.label, usd: buraco });
    return {
      ...s,
      points: s.points.map((p, i) => (i >= iDegrau ? { ...p, usd: p.usd + buraco } : p)),
      latestUsd: verdadeiro,
    };
  });

  return { series, corrigidos, naoCorrigidos };
}
