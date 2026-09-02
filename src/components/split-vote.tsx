"use client";

// A urna. Cada um distribui 100 pontos entre OS OUTROS.
//
// A tela existe para uma coisa: transformar a conversa da reunião num vetor de
// proporções que o dono do split assina. Ela não move dinheiro e não deve dar
// a impressão de que move.

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Lock, LockOpen, PenLine, Plug, RotateCcw, Scale, Users, Vote } from "lucide-react";
import { abrirRodada, estadoRodada, fecharRodada, listarPagamentos, reabrirRodada, registrarAplicacao, votar, vetorParaAplicar, type EstadoRodada, type PagamentoRegistrado } from "@/app/actions/split-vote";
import { SPLIT_DO_TIME } from "@/lib/split-vote-config";
import { useWallet } from "@/components/wallet-provider";
import { Landmark } from "lucide-react";
import { isOk } from "@/lib/reading";

const TOTAL = 100;
const curto = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function SplitVote() {
  const [e, setE] = useState<EstadoRodada | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pontos, setPontos] = useState<Record<string, number>>({});

  const [busy, setBusy] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [novoLabel, setNovoLabel] = useState("");
  // Já vem com o split do time. Ver o comentário em split-vote-config.ts.
  const [novoSplit, setNovoSplit] = useState(SPLIT_DO_TIME);

  const carregar = () =>
    estadoRodada().then((r) => {
      // Falha de leitura NÃO vira urna vazia: uma tela que decide pagamento não
      // pode mostrar "ninguém elegível" quando o que houve foi rede caindo.
      if (!r.ok) return setErr(r.error);
      setErr(null);
      setE(r.estado);
      if (r.estado.meuVoto) {
        setPontos(r.estado.meuVoto);
        return;
      }
      // Sem voto anterior, as barras nascem DIVIDIDAS POR IGUAL, não em zero.
      // Zero seria um chute nosso disfarçado de neutro — e obrigaria a pessoa a
      // construir os 100 do nada antes de o botão sequer habilitar. Igual é o
      // único ponto de partida que não afirma preferência nenhuma, e é o que
      // acontece hoje no contrato: dez destinatários a 10%.
      const alvos = r.estado.elegiveis
        .map((x) => x.address.toLowerCase())
        .filter((a) => a !== r.estado.meuEndereco?.toLowerCase());
      if (!alvos.length) return;
      const q = Math.floor(TOTAL / alvos.length);
      const sobra = TOTAL - q * alvos.length;
      const inicial: Record<string, number> = {};
      alvos.forEach((a, i) => (inicial[a] = q + (i < sobra ? 1 : 0)));
      setPontos(inicial);
    });

  useEffect(() => {
    void carregar();
  }, []);

  if (err) return <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">⚠ {err}</p>;
  if (!e) return <p className="text-sm text-foreground-faint">carregando…</p>;

  const outros = e.elegiveis.filter((x) => x.address.toLowerCase() !== e.meuEndereco?.toLowerCase());
  /**
   * Move uma barra. Só ela.
   *
   * A primeira versão reequilibrava as outras sozinha para o total fechar 100
   * — e na prática atrapalhou: mexer numa pessoa mexia em todo mundo, e quem
   * votava perdia o que já tinha ajustado. Previsível ganha de esperto: aqui a
   * barra que você arrasta é a única que muda, e o contador embaixo diz quanto
   * falta. A conta fica visível em vez de automática.
   */
  function ajustar(alvo: string, bruto: number) {
    const v = Math.max(0, Math.min(TOTAL, Math.round(bruto)));
    setPontos((prev) => ({ ...prev, [alvo]: v }));
  }

  /** Ponto de partida, e o botão de recomeçar do zero. */
  function distribuirIgual() {
    const alvos = outros.map((o) => o.address.toLowerCase());
    if (!alvos.length) return;
    const q = Math.floor(TOTAL / alvos.length);
    const sobra = TOTAL - q * alvos.length;
    const novo: Record<string, number> = {};
    alvos.forEach((a, i) => (novo[a] = q + (i < sobra ? 1 : 0)));
    setPontos(novo);
  }

  const usados = Object.values(pontos).reduce((s, n) => s + (Number(n) || 0), 0);
  const faltam = TOTAL - usados;

  async function enviar() {
    if (!e?.round) return;
    setBusy("votar");
    setSalvo(false);
    const r = await votar(
      e.round.id,
      Object.entries(pontos).map(([alvo, p]) => ({ alvo, pontos: Number(p) || 0 })),
    );
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setErr(null);
    setSalvo(true);
    await carregar();
  }

  return (
    <div className="space-y-6">
      {/* ── Abrir rodada (admin) ── */}
      {e.souAdmin && (!e.round || e.round.status === "closed") && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Vote className="h-4 w-4 text-accent" /> Abrir a votação da semana
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs text-foreground-subtle">
            Os elegíveis são lidos do contrato do split, na cadeia — quem está nele hoje é quem vota e
            quem recebe. Uma rodada aberta por vez.
          </p>
          {/* O endereço vem preenchido: pedir que alguém COLE um contrato é a
              forma mais fácil de dividir dinheiro no lugar errado — um
              caractere trocado ainda é um endereço "válido", e a urna
              obedeceria calada. O campo continua editável para o caso raro de
              outro split, mas o caminho normal não passa pela área de
              transferência de ninguém. */}
          <div className="mt-4 flex flex-wrap gap-2">
            <input value={novoLabel} onChange={(ev) => setNovoLabel(ev.target.value)} placeholder="Semana de 01/09"
              className="w-44 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none" />
            <input value={novoSplit} onChange={(ev) => setNovoSplit(ev.target.value)} placeholder="0x… endereço do split" spellCheck={false} title="O split do time vem preenchido. Só troque se a rodada for decidir outro contrato."
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none" />
            <button type="button" disabled={busy === "abrir" || !novoSplit.trim()}
              onClick={async () => { setBusy("abrir"); const r = await abrirRodada(novoLabel, novoSplit); setBusy(null); if (!r.ok) return setErr(r.error); setNovoSplit(SPLIT_DO_TIME); setNovoLabel(""); await carregar(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40">
              {busy === "abrir" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />} Abrir
            </button>
          </div>
        </section>
      )}

      {!e.round && !e.souAdmin && (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-muted">
          Nenhuma votação aberta. Ela abre depois da reunião de segunda.
        </p>
      )}

      {/* ── A cédula ── */}
      {e.round && e.round.status === "open" && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{e.round.label}</h2>
              <p className="mt-1 max-w-2xl text-xs text-foreground-subtle">
                Distribua <strong>{TOTAL} pontos</strong> entre as outras pessoas. Você não aparece na
                lista — a sua fatia é o que os outros te derem.
                <br />
                O voto é anônimo: ninguém, nem o admin, vê quem votou o quê. Mas as cédulas sem nome
                ficam visíveis no fim, para qualquer um poder refazer a conta.
                <br />
                <strong className="text-warning">Não votar tira a sua voz, não a sua fatia:</strong> quem
                não vota não influencia a de ninguém, mas continua recebendo o que os colegas lhe deram.
              </p>
            </div>
            {e.souAdmin && (
              <button type="button" disabled={busy === "fechar"}
                onClick={async () => { setBusy("fechar"); await fecharRodada(e.round!.id); setBusy(null); await carregar(); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40">
                {busy === "fechar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />} Fechar e apurar
              </button>
            )}
          </div>

          {!e.souElegivel ? (
            <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Você não está no split desta rodada, então não vota nela. Para entrar, sua carteira precisa
              estar no contrato e cadastrada na página Team.
            </p>
          ) : (
            <>
              {/* Quem já votou, enquanto a urna está aberta. Participação não é
                  resultado: dizer que faltam três pessoas não conta o voto de
                  ninguém, e é o que permite decidir a hora de fechar. */}
              {(e.jaVotaram.length > 0 || e.faltamVotar.length > 0) && (
                <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
                    Participação · {e.jaVotaram.length} de {e.jaVotaram.length + e.faltamVotar.length}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.jaVotaram.map((v) => (
                      <span key={v.address} className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                        ✓ @{v.username}
                      </span>
                    ))}
                    {e.faltamVotar.map((v) => (
                      <span key={v.address} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-faint">
                        @{v.username}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <MeritoPainel merito={e.merito} pontos={e.pontosDeMerito} />

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-[11px] text-foreground-faint">
                  Arraste cada barra. O total precisa fechar {TOTAL} para o voto valer.
                </p>
                <button type="button" onClick={distribuirIgual}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                  <Scale className="h-3 w-3" /> tudo igual
                </button>
              </div>

              <ul className="mt-2 space-y-1.5">
                {outros.map((o) => {
                  const k = o.address.toLowerCase();
                  const v = Math.round(pontos[k] ?? 0);
                  return (
                    <li key={o.address} className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {o.username ? `@${o.username}` : <span className="font-mono text-xs">{curto(o.address)}</span>}
                          <span className="ml-2 text-[11px] text-foreground-faint">hoje {pct(o.shareAtual)}</span>
                        </span>
                        <span className={`w-12 text-right font-mono text-sm tabular-nums ${v === 0 ? "text-foreground-faint" : "text-foreground"}`}>
                          {v}
                        </span>
                      </div>
                      <input type="range" min={0} max={TOTAL} step={1} value={v}
                        aria-label={`pontos para ${o.username ?? o.address}`}
                        onChange={(ev) => ajustar(k, Number(ev.target.value))}
                        style={{ accentColor: "var(--accent)" }}
                        className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border" />
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className={`font-mono text-sm tabular-nums ${faltam === 0 ? "text-success" : "text-foreground-muted"}`}>
                  {usados} / {TOTAL}
                  {faltam > 0 && <span className="text-warning"> — faltam {faltam}</span>}
                  {faltam < 0 && <span className="text-danger"> — {-faltam} a mais</span>}
                </span>
                <div className="flex items-center gap-2">
                  {salvo && <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> voto guardado</span>}
                  <button type="button" onClick={enviar} disabled={busy === "votar" || faltam !== 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy === "votar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {e.meuVoto ? "Atualizar meu voto" : "Votar"}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-foreground-faint">
                Dá para mudar o voto até a rodada fechar. O resultado só aparece depois disso — ver ao
                vivo transformaria a votação numa corrida por quem vota por último.
              </p>
            </>
          )}
        </section>
      )}

      <RegistroPagamentos />

      {/* ── Resultado ── */}
      {e.round && e.round.status === "closed" && e.resultado && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
              <Users className="h-4 w-4 text-accent" /> {e.round.label} — apurado
            </h2>
            {e.souAdmin && (
              <button type="button" disabled={busy === "reabrir"}
                onClick={async () => { setBusy("reabrir"); const r = await reabrirRodada(e.round!.id); setBusy(null); if (!r.ok) return setErr(r.error); await carregar(); }}
                title="Volta a aceitar voto. As cédulas já dadas continuam valendo."
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40">
                {busy === "reabrir" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reabrir
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-foreground-subtle">
            {e.resultado.votaram} de {e.resultado.elegiveis} votaram.
            {e.resultado.abstiveram.length > 0 && (
              <> {e.resultado.abstiveram.length} não votaram — sem voz na conta, mas com fatia.</>
            )}
          </p>
          {/* O caso que parece bug e não é: com pouca gente votando, quase todo
              mundo é zerado pela regra da abstenção e o resultado sai tudo em
              zero — inclusive os pontos que QUEM votou distribuiu. Sem esta
              frase, a leitura natural é "a urna perdeu meu voto". */}
          {e.resultado.votaram < e.resultado.elegiveis && (
            <p className="mt-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] leading-relaxed text-foreground-muted">
              {e.resultado.elegiveis - e.resultado.votaram} pessoa
              {e.resultado.elegiveis - e.resultado.votaram === 1 ? "" : "s"} ainda não votaram
              {e.resultado.abstiveram.length > 0 && (
                <> — {e.resultado.abstiveram.map((a) => `@${a.username}`).join(", ")}</>
              )}
              . Elas continuam recebendo o que os outros lhes deram; o que falta é a voz delas na conta.
              Dá para <strong>reabrir</strong>, juntar o resto da turma e fechar de novo.
            </p>
          )}
          {/* Quem não pôde votar aparece SEPARADO de quem escolheu não votar.
              A régua é a mesma — zero —, mas a razão não é, e só uma delas é
              resolvível com um cadastro. */}
          {e.resultado.semCadastro.length > 0 && (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
              ⚠ {e.resultado.semCadastro.length === 1 ? "Um endereço do split não pôde votar" : `${e.resultado.semCadastro.length} endereços do split não puderam votar`}:{" "}
              {e.resultado.semCadastro.map((x) => curto(x.address)).join(", ")}. Não têm carteira
              cadastrada na página Team, então a urna não consegue casar a pessoa com o endereço.
              Ficaram com zero por <strong>falta de cadastro</strong>, não por escolha — cadastre a
              carteira e eles votam na próxima.
            </p>
          )}

          <ul className="mt-4 space-y-1.5">
            {e.resultado.linhas.map((l) => (
              <li key={l.address} className="flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {l.username ? `@${l.username}` : <span className="font-mono text-xs">{curto(l.address)}</span>}
                </span>
                <span className="font-mono text-xs tabular-nums text-foreground-faint">{l.pontos} pts</span>
                <span className="w-20 text-right font-mono text-xs tabular-nums text-foreground-faint">era {pct(l.shareAtual)}</span>
                <span className={`w-20 text-right font-mono text-sm font-semibold tabular-nums ${l.share > l.shareAtual ? "text-success" : l.share < l.shareAtual ? "text-warning" : "text-foreground"}`}>
                  {pct(l.share)}
                </span>
              </li>
            ))}
          </ul>

          {e.vetor && <AplicarNoContrato round={e.round} podeAplicar={e.souAdmin} vetor={e.vetor} />}

          <details className="mt-5">
            <summary className="cursor-pointer text-xs font-medium text-foreground-muted hover:text-foreground">
              Cédulas sem nome ({e.resultado.cedulasAnonimas.length}) — para conferir a conta
            </summary>
            <p className="mt-2 text-[11px] text-foreground-faint">
              Sem autor e em ordem embaralhada de forma estável, para que a ordem não entregue quem votou
              o quê. Somando as colunas você chega no mesmo resultado acima.
            </p>
            <div className="mt-2 space-y-1">
              {e.resultado.cedulasAnonimas.map((c, i) => (
                <div key={i} className="overflow-x-auto rounded-md border border-border bg-surface-elevated px-3 py-1.5 font-mono text-[11px] text-foreground-muted">
                  {Object.entries(c).map(([a, p]) => {
                    const alvo = e.elegiveis.find((x) => x.address.toLowerCase() === a.toLowerCase());
                    return `${alvo?.username ? "@" + alvo.username : curto(a)}:${p}`;
                  }).join("  ·  ")}
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

/**
 * O último passo: o resultado vira transação.
 *
 * Antes esta parte era um `<pre>` com JSON para copiar e colar noutro lugar. Um
 * vetor de alocações copiado à mão entre duas telas é onde o erro entra — e
 * aqui um dígito trocado é o pagamento de alguém.
 *
 * O botão NÃO é automático de propósito: a apuração fecha sozinha, mas o clique
 * que transforma voto em dinheiro é humano. E ele só existe para quem administra
 * a rodada, porque `updateSplit` é `onlyOwner` — para qualquer outra carteira a
 * transação reverteria, e oferecer um botão que reverte é pior que não oferecer.
 *
 * O `distributionIncentive` vem do servidor, lido da cadeia AGORA, e não daqui:
 * é o campo que ninguém olha e que, zerado por descuido, tira o incentivo de
 * quem dispara a distribuição sem nenhum aviso na tela.
 */
function AplicarNoContrato({
  round,
  podeAplicar,
  vetor,
}: {
  round: NonNullable<EstadoRodada["round"]>;
  podeAplicar: boolean;
  vetor: NonNullable<EstadoRodada["vetor"]>;
}) {
  const { address, available, connect, connecting, ensureChain } = useWallet();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const fechada = round.status === "closed";
  const explorer = round.chain === "base" ? "https://basescan.org/tx/" : "https://etherscan.io/tx/";

  async function aplicar() {
    setBusy(true);
    setErro(null);
    setHash(null);
    try {
      const pronto = await vetorParaAplicar(round.id);
      if (!pronto.ok) return setErro(pronto.error);
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) return setErro("Nenhuma carteira encontrada neste navegador.");
      const conta = address ?? (await connect());
      if (!conta) return;
      await ensureChain(round.chain === "base" ? "0x2105" : "0x1");

      // Encoding manual da struct: um único tuple dinâmico, então o head é o
      // offset 0x20 e o corpo vem logo atrás.
      const { encodeFunctionData } = await import("viem");
      const data = encodeFunctionData({
        abi: [
          {
            name: "updateSplit",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              {
                name: "_split",
                type: "tuple",
                components: [
                  { name: "recipients", type: "address[]" },
                  { name: "allocations", type: "uint256[]" },
                  { name: "totalAllocation", type: "uint256" },
                  { name: "distributionIncentive", type: "uint16" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "updateSplit",
        args: [
          {
            recipients: pronto.recipients as `0x${string}`[],
            allocations: pronto.allocations.map((a) => BigInt(a)),
            totalAllocation: BigInt(pronto.totalAllocation),
            distributionIncentive: pronto.distributionIncentive,
          },
        ],
      });
      const tx = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: conta, to: pronto.splitAddress, data }],
      })) as string;
      setHash(tx);
      // O registro é gravado AQUI, com o hash na mão. Esperar a confirmação
      // para gravar perderia o peso se a aba fechasse no meio — e o peso é
      // justamente o que não dá para reconstruir depois, porque a apuração
      // muda quando o split muda.
      await registrarAplicacao(round.id, tx, {
        recipients: pronto.recipients,
        allocations: pronto.allocations,
        totalAllocation: pronto.totalAllocation,
      }).catch(() => {});
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setErro(/user rejected|denied/i.test(m) ? "Assinatura cancelada na carteira." : m.slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface-elevated p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Aplicar no contrato</p>
      <p className="mt-1 text-[11px] leading-relaxed text-foreground-subtle">
        {vetor.recipients.length} destinatário{vetor.recipients.length === 1 ? "" : "s"} · soma{" "}
        {vetor.allocations.reduce((s, a) => s + a, 0).toLocaleString("pt-BR")} de{" "}
        {vetor.totalAllocation.toLocaleString("pt-BR")}. O incentivo de distribuição atual é preservado.
      </p>

      {!fechada ? (
        <p className="mt-2 text-[11px] leading-relaxed text-warning">
          Feche a rodada antes de aplicar — enquanto ela está aberta a apuração ainda pode mudar.
        </p>
      ) : !podeAplicar ? (
        <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
          Quem assina é a carteira dona do split. Esta tela mostra o resultado; aplicar é com quem administra.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void aplicar()}
          disabled={busy || connecting}
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : address ? <PenLine className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
          {busy ? "Assinando…" : address ? "Aplicar com a carteira dona" : available ? "Conectar e aplicar" : "Instale uma carteira"}
        </button>
      )}

      {hash && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Enviada.{" "}
          <a href={`${explorer}${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
            ver na cadeia <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      )}
      {erro && <p className="mt-2 text-[11px] leading-relaxed text-warning">⚠ {erro}</p>}
    </div>
  );
}

/**
 * A parte DURA da cédula: pontos que vêm de receita medida.
 *
 * Fica ACIMA das barras de propósito. A ordem na tela é a ordem do argumento:
 * primeiro o que o extrato mostra, depois a opinião de cada um. Invertido, a
 * opinião pareceria a regra e o medido, a nota de rodapé.
 *
 * Três estados, e nenhum deles é um zero mudo. Mérito que não pôde ser medido
 * NÃO é mérito zero: dizer "ninguém trouxe nada" quando o indexador está fora
 * do ar seria a mesma mentira que esta base passou a semana removendo.
 */
function MeritoPainel({ merito, pontos }: { merito: EstadoRodada["merito"]; pontos: number }) {
  const [aberto, setAberto] = useState(false);
  // Três estados, e o do meio importa: `insufficient` é leitura que deu certo
  // mas ainda não significa nada. Nenhum dos dois vira zero na tela.
  if (!isOk(merito)) {
    const motivo = merito.state === "unread" ? merito.reason : merito.note;
    return (
      <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
        ⚠ O mérito não pôde ser medido — {motivo}. Isto NÃO quer dizer que ninguém trouxe receita;
        quer dizer que a leitura falhou. A votação segue nos {TOTAL} pontos de opinião.
      </p>
    );
  }
  const m = merito.value;
  const houve = m.pessoas.length > 0 && m.totalUsd > 0;
  const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
          <Landmark className="h-3 w-3" /> Mérito · {pontos} dos {TOTAL} pontos
        </p>
        <span className="font-mono text-[11px] text-foreground-faint">
          receita medida nos últimos {m.janelaDias} dias
          {m.pessoas.some((p) => p.soChao) ? " · — = piso" : ""}
        </span>
      </div>

      {houve ? (
        <ul className="mt-2 space-y-1">
          {m.pessoas.map((p) => (
            <li key={p.username} className="flex items-center gap-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground">@{p.username}</span>
              {/* Chão e medição não podem parecer a mesma coisa. Um traço no
                  lugar do valor diz "creditada, sem valor medido" — escrever
                  US$ 0,00 afirmaria que ela não trouxe nada. */}
              <span className="font-mono tabular-nums text-foreground-faint">
                {p.soChao ? <span title="creditada, mas sem valor medido — recebe o piso">—</span> : usd(p.usd)}
              </span>
              <span className={`w-10 text-right font-mono font-semibold tabular-nums ${p.soChao ? "text-foreground-muted" : "text-accent"}`}>
                {p.pontos} pt
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
          Nenhuma fonte creditada rendeu dólar medido nesta janela — então os {pontos} pontos de mérito
          não são distribuídos, e a cédula fica inteira nos {TOTAL} pontos de opinião. Os motivos estão
          abaixo, um por fonte.
        </p>
      )}

      {m.semMedida.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="mt-2 text-[11px] font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            {aberto ? "esconder" : `por que ${m.semMedida.length} fonte${m.semMedida.length === 1 ? "" : "s"} não entrou na conta`}
          </button>
          {aberto && (
            <ul className="mt-1.5 space-y-1 border-t border-border pt-2">
              {m.semMedida.map((f, i) => (
                <li key={i} className="text-[11px] leading-snug text-foreground-faint">
                  <span className="text-foreground-muted">{f.rotulo}</span> — {f.semMedida}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * O registro de pagamentos: o peso que virou contrato, e o que ele rendeu.
 *
 * Peso e valor vêm de lugares diferentes DE PROPÓSITO. O peso é congelado no
 * banco no instante da assinatura — ele não pode mudar depois, senão o registro
 * vira reconstrução. O valor é lido da cadeia a cada consulta, recortado pela
 * vigência daquele peso: guardá-lo congelaria um número que ainda cresce, e a
 * primeira distribuição depois do registro já o deixaria mentindo.
 */
function RegistroPagamentos() {
  const [itens, setItens] = useState<PagamentoRegistrado[] | null>(null);
  useEffect(() => {
    void listarPagamentos().then((r) => setItens(r.ok ? r.pagamentos : []));
  }, []);
  if (!itens || itens.length === 0) return null;

  const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dia = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Landmark className="h-4 w-4 text-accent" /> Registro de pagamentos
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-foreground-subtle">
        Cada vez que um resultado vira contrato, o peso é congelado aqui com o hash que prova. O valor
        ao lado é lido da cadeia agora, recortado pelo tempo em que aquele peso esteve valendo.
      </p>

      <div className="mt-4 space-y-4">
        {itens.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-surface-elevated p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{p.roundLabel}</span>
              <span className="font-mono text-[11px] text-foreground-faint">
                {dia(p.appliedAt)} · por @{p.appliedBy}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-foreground-faint">
              <a
                href={`${p.chain === "base" ? "https://basescan.org/tx/" : "https://etherscan.io/tx/"}${p.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-accent hover:underline"
              >
                {p.txHash.slice(0, 10)}…{p.txHash.slice(-6)} <ExternalLink className="h-3 w-3" />
              </a>
              {p.distribuidoUsd != null ? (
                <span>· distribuiu {usd(p.distribuidoUsd)} enquanto valeu</span>
              ) : (
                <span className="text-warning">· {p.semValor}</span>
              )}
            </div>

            <ul className="mt-2 space-y-1">
              {p.linhas.map((l) => (
                <li key={l.address} className="flex items-center gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {l.username ? `@${l.username}` : <span className="font-mono text-[11px]">{curto(l.address)}</span>}
                  </span>
                  <span className="w-16 text-right font-mono tabular-nums text-foreground-muted">{pct(l.share)}</span>
                  {/* Valor não lido aparece como travessão, nunca como zero: um
                      zero aqui afirmaria que a pessoa não recebeu nada. */}
                  <span className="w-24 text-right font-mono font-semibold tabular-nums text-foreground">
                    {l.recebidoUsd == null ? "—" : usd(l.recebidoUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
