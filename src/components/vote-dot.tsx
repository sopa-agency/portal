"use client";

/**
 * O ponto na aba "Pagamentos" quando há rodada aberta.
 *
 * Isto era um banner dentro de Membros, que mandava a pessoa para /votacao.
 * A urna agora É a aba, então o elo virou o que ele sempre quis ser: um
 * aviso de que existe rodada acontecendo, no lugar onde a pessoa clica.
 *
 * Fica mudo no caso comum. Um aviso permanente vira ruído e some do olhar; a
 * rodada precisa ser vista JUSTAMENTE porque é rara.
 */

import { useEffect, useState } from "react";
import { estadoRodada } from "@/app/actions/split-vote";

export function VoteDot() {
  const [dot, setDot] = useState<{ tone: string; title: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    estadoRodada().then(
      (r) => {
        if (!vivo || !r.ok) return;
        const { round, souElegivel, meuVoto } = r.estado;
        if (!round || round.status !== "open") return;
        // Falta o SEU voto é a única coisa que pede ação de quem está olhando.
        // Quem já votou, ou quem nem está no split, recebe o aviso mais fraco:
        // há rodada, mas não há nada para essa pessoa fazer.
        const cobra = souElegivel && meuVoto == null;
        setDot({
          tone: cobra ? "bg-warning" : "bg-accent",
          title: cobra ? `Votação aberta: ${round.label} — falta o seu voto` : `Votação aberta: ${round.label}`,
        });
      },
      // Leitura que não respondeu não acende e não apaga nada: um ponto aceso
      // por engano cobra um voto que talvez não exista.
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, []);

  if (!dot) return null;
  return <span aria-hidden title={dot.title} className={`h-1.5 w-1.5 rounded-full ${dot.tone}`} />;
}
