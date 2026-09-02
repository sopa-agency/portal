"use client";

// O botão de atualizar do tesouro — e o esqueleto que ele comanda.
//
// A página inteira mostrava um esqueleto de página inteira (loading.tsx) a cada
// navegação. O efeito era o contrário do pretendido: um retângulo cinza do
// tamanho da tela LÊ como "está tudo por vir" e faz o carregamento parecer mais
// longo do que é, mesmo quando o primeiro byte chega em 2 segundos.
//
// Agora a página aparece pronta, com o que estava guardado, e o esqueleto
// aparece SÓ onde o dado realmente vai mudar — os números e a área do gráfico —
// e SÓ quando a pessoa pede a atualização. Esqueleto é para o que está mudando
// agora, não para o que já está na mão.
//
// A COR DO BOTÃO é o estado do dado, não enfeite:
//   verde    — o último sync é recente; o que você está lendo é de agora
//   vermelho — o dado está velho, ou a última tentativa não conseguiu ler
// Um botão neutro obrigaria a pessoa a clicar para descobrir se precisava.

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { refreshTreasury } from "@/app/actions/treasury";

type RefreshCtx = {
  pending: boolean;
  atualizar: () => void;
  /** Dado velho ou última leitura incompleta — o botão fica vermelho. */
  ruim: boolean;
  syncedAt: string | null;
  erro: string | null;
};
const Ctx = createContext<RefreshCtx>({ pending: false, atualizar: () => {}, ruim: false, syncedAt: null, erro: null });

/** True enquanto uma atualização pedida está em curso. */
export function useTreasuryRefreshing(): boolean {
  return useContext(Ctx).pending;
}

export function TreasuryRefreshProvider({
  syncedAt,
  stale,
  hadFailure = false,
  children,
}: {
  /** ISO do sync mais recente, ou null se nunca sincronizou. Só para exibir. */
  syncedAt: string | null;
  /**
   * O dado está velho. Calculado no SERVIDOR, de propósito.
   *
   * Comparar com `Date.now()` aqui seria impuro no render e, pior, o servidor e
   * o navegador chegariam a respostas diferentes — o botão nasceria verde no
   * HTML e viraria vermelho na hidratação. Quem tem o relógio de referência é
   * quem leu o dado.
   */
  stale: boolean;
  /** A última leitura deixou algo por ler. */
  hadFailure?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useLocale().t.treasury.refresh;
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [falhouAgora, setFalhouAgora] = useState(hadFailure);

  const ruim = stale || falhouAgora;

  function atualizar() {
    setErro(null);
    start(async () => {
      try {
        const r = await refreshTreasury();
        setFalhouAgora(r.falhas.length > 0);
        if (r.falhas.length) setErro(t.readFail(r.falhas.length));
      } catch (e) {
        setFalhouAgora(true);
        setErro(e instanceof Error ? e.message : String(e));
      }
      router.refresh();
    });
  }

  return (
    <Ctx.Provider value={{ pending, atualizar, ruim, syncedAt, erro }}>
      {children}
    </Ctx.Provider>
  );
}

/**
 * O botão. Fica onde sempre esteve, no cabeçalho — o que mudou é que agora ele
 * carrega a COR do estado do dado e comanda os esqueletos lá embaixo.
 */
export function TreasuryRefresh() {
  const { pending, atualizar, ruim, syncedAt, erro } = useContext(Ctx);
  const { locale, t: dict } = useLocale();
  const t = dict.treasury.refresh;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
        {erro && <span className="text-[11px] text-warning">{erro}</span>}
        <span className="text-[11px] text-foreground-faint">
          {syncedAt
            ? t.dataFrom(
                new Date(syncedAt).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              )
            : t.neverSynced}
        </span>
        <button
          type="button"
          onClick={atualizar}
          disabled={pending}
          title={
            pending ? t.busy : ruim ? t.staleTitle : t.freshTitle
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            ruim
              ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20"
              : "border-success/40 bg-success/10 text-success hover:bg-success/20"
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
          {pending ? t.busy : t.action}
        </button>
    </div>
  );
}

/**
 * O esqueleto localizado.
 *
 * Envolve o que está sendo relido. Fora de uma atualização ele não faz nada —
 * é o filho que aparece, com o dado guardado, imediatamente.
 */
export function RefreshSkeleton({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const pending = useTreasuryRefreshing();
  if (!pending) return <>{children}</>;
  return (
    <div className={`relative ${className}`} aria-busy="true">
      {/* O conteúdo velho fica embaixo, apagado: some o número, fica o LAYOUT.
          Trocar por um retângulo do zero faria a página pular na hora de voltar. */}
      <div className="pointer-events-none opacity-0">{children}</div>
      <div className="absolute inset-0 animate-pulse rounded-xl bg-surface-elevated" />
    </div>
  );
}
