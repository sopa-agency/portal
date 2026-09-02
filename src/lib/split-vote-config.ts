// Configuração da urna que o CLIENTE também precisa ler.
//
// Fica separada de `split-vote.ts` de propósito: aquele arquivo importa prisma
// e crypto, e um `import` dele num componente cliente arrastaria o banco de
// dados para dentro do navegador. Uma constante não vale esse preço.

/**
 * O split que paga o time. É este que a votação semanal decide.
 *
 * Existe como constante porque NÃO existia em lugar nenhum: nem no código, nem
 * no banco. O portal sabia o Safe da SOPA, os splits de receita e o subnet — e
 * justamente o contrato que paga as pessoas era o único que ninguém tinha
 * anotado. O efeito na tela era pedir que alguém COLASSE um endereço de
 * contrato para abrir a rodada, o que é a forma mais fácil de dividir dinheiro
 * no contrato errado: um caractere trocado aponta para outro lugar, e a urna
 * obedeceria sem reclamar, porque um endereço válido é sempre "válido".
 *
 * Medido na cadeia: 10 destinatários a 10% cada, dono
 * `0x8Bf5941d…3C26` (a EOA do Vlad). NÃO confundir com o split de TOPO
 * (`0xcc7E971f…3A4E`), que reparte entre Gnars, time e SOPA e no qual nenhuma
 * pessoa do time aparece — apontar a rodada para ele deixaria a urna sem
 * ninguém elegível.
 */
export const SPLIT_DO_TIME = "0x843429422EbEec7AAefe8B244f334783007a3A4A";
