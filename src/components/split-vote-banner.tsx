"use client";

// O aviso da urna dentro de "Membros".
//
// A urna mora em /votacao, mas quem decide "quem recebe o quê" olha para a aba
// Membros — e ali ninguém ficava sabendo que havia rodada aberta. Este banner
// é o elo: compacto, e mudo quando não há o que dizer. Um aviso permanente
// vira ruído e some do olhar; a rodada precisa ser vista JUSTAMENTE porque é
// rara.

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Vote } from "lucide-react";
import { estadoRodada, type EstadoRodada } from "@/app/actions/split-vote";
import { ReadFailed } from "@/components/data-state";

type Leitura =
  | { status: "loading" }
  | { status: "error"; message: string }
  // `lidoEm` é o relógio da leitura: o prazo é calculado a partir dele, não
  // de um Date.now() no render — render precisa ser puro e reproduzível.
  | { status: "ok"; estado: EstadoRodada; lidoEm: number };

/** "fecha em 3h" / "fecha em 40 min" / "fechando" — relativo, porque o que
 *  importa para quem ainda não votou é quanto tempo sobra, não a data. */
function prazo(fechaEm: string, agora: number): string {
  const ms = Date.parse(fechaEm) - agora;
  if (!Number.isFinite(ms)) return "";
  // A urna fecha sozinha no servidor; passou da hora, é questão de minutos.
  if (ms <= 0) return "fechando";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `fecha em ${min} min`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `fecha em ${h}h`;
  return `fecha em ${Math.round(h / 24)} dias`;
}

export function SplitVoteBanner() {
  const [leitura, setLeitura] = useState<Leitura>({ status: "loading" });

  useEffect(() => {
    let vivo = true;
    estadoRodada().then(
      (r) => {
        if (!vivo) return;
        setLeitura(r.ok ? { status: "ok", estado: r.estado, lidoEm: Date.now() } : { status: "error", message: r.error });
      },
      (err: unknown) => {
        if (!vivo) return;
        setLeitura({ status: "error", message: err instanceof Error ? err.message : "a chamada não respondeu" });
      },
    );
    return () => {
      vivo = false;
    };
  }, []);

  // Enquanto carrega, nada: o caso comum (sem rodada) termina em silêncio, e
  // um "carregando…" que some sem deixar nada no lugar só chama atenção.
  if (leitura.status === "loading") return null;

  // Falha de leitura NÃO vira "não há rodada". São estados diferentes, e só
  // um deles é verdade quando a rede cai.
  if (leitura.status === "error") {
    return (
      <ReadFailed>
        Não consegui ler a rodada de votação ({leitura.message}). Isso não quer dizer que não haja uma.
      </ReadFailed>
    );
  }

  const { round, fechaEm, souElegivel, meuVoto, resultado } = leitura.estado;
  const lidoEm = leitura.lidoEm;
  if (!round) return null;

  if (round.status === "open") {
    const votou = meuVoto != null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-accent-border bg-accent-bg px-4 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Vote className="h-4 w-4 text-accent" />
          Votação aberta: {round.label}
        </span>
        {/* Quem não está no split não vota nela — dizer "falta o seu voto" a
            essa pessoa seria cobrar o impossível. */}
        {!souElegivel ? (
          <span className="text-foreground-muted">você não está no split desta rodada</span>
        ) : votou ? (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> você já votou
          </span>
        ) : (
          <span className="font-semibold text-warning">falta o seu voto</span>
        )}
        {fechaEm && (
          <span
            className="inline-flex items-center gap-1 text-foreground-subtle"
            title={new Date(fechaEm).toLocaleString("pt-BR")}
          >
            <Clock className="h-3.5 w-3.5" /> {prazo(fechaEm, lidoEm)}
          </span>
        )}
        <Link href="/votacao" className="ml-auto font-semibold text-accent underline-offset-2 hover:underline">
          {votou ? "rever meu voto →" : "votar →"}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-3 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
        <CheckCircle2 className="h-4 w-4 text-success" />
        Votação apurada: {round.label}
      </span>
      {resultado && (
        <span className="text-foreground-muted">
          {resultado.votaram} de {resultado.elegiveis} votaram
        </span>
      )}
      <Link href="/votacao" className="ml-auto font-semibold text-accent underline-offset-2 hover:underline">
        ver o resultado →
      </Link>
    </div>
  );
}
