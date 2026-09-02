import { redirect } from "next/navigation";

// A urna deixou de ser rota própria e virou a aba Pagamentos do tesouro:
// decidir a proporção e mandar o dinheiro são a mesma pergunta.
//
// A rota continua existindo porque links já foram compartilhados — inclusive
// nos avisos de rodada aberta. Um 404 aqui mandaria quem ia votar para o nada.
export default function VotacaoPage() {
  redirect("/treasury?tab=pagamentos");
}
