import { notFound } from "next/navigation";
import { ExternalLink, Flame, FlaskConical, GitBranch, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section-heading";
import { getActiveProject } from "@/projects/index";
import { isOk } from "@/lib/reading";
import { BURNDOWN, TETO_HONESTO, lerRepo, lerMockup } from "@/lib/burndown";

export const dynamic = "force-dynamic";

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dias = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/** As perguntas que a cadeia ainda não respondeu, na ordem do quanto podem matar. */
const ABERTAS = [
  {
    id: "E1",
    mata: true,
    titulo: "A Doppler aceita um quote mint Token-2022?",
    corpo:
      "O prêmio inteiro depende disso e está NÃO VERIFICADO. O SDK não oferece preset Token-2022 para quote (launchTokenPrograms.token2022Base() ainda usa TOKEN_PROGRAM_ADDRESS), todo teste unitário usa quote SPL-Token, e o Rust é fechado. Falhar ⇒ a Doppler não hospeda o produto como especificado — e aí se testa na Meteora DBC antes de concluir que é impossível.",
  },
  {
    id: "E2",
    mata: true,
    titulo: "O que quebra quando um transfer hook entra em vigor no quote mint?",
    corpo:
      "Esperado: tudo reverte e a liquidez fica presa. Decide se dá para oferecer pares xStocks algum dia, ou se precisa de uma camada de wrapper/escrow.",
  },
  {
    id: "E3",
    mata: false,
    titulo: "O protocolFeeBps é fotografado no lançamento?",
    corpo:
      `Fortemente inferido e não provado. É o que decide se "${TETO_HONESTO}% para sempre" é uma promessa que dá para cumprir, ou só uma medição de hoje.`,
  },
  {
    id: "E4",
    mata: false,
    titulo: "Quem pode chamar cpmm::set_fees numa pool migrada?",
    corpo:
      "Se o admin do CPMM puder cortar o feeSplitBps depois da migração, o fluxo colhido encolhe mesmo com a divisão sendo respeitada.",
  },
  {
    id: "E5b",
    mata: false,
    titulo: "O swap do crank de burn funciona com quote Token-2022?",
    corpo:
      "Resolvido no formato da pool, aberto na execução. O crank compra contra a própria pool base/quote do lançamento, então a forma existe por construção — falta ver rodar.",
  },
];

/** O que a cadeia JÁ respondeu. Registrar o que não é problema vale tanto quanto o que é. */
const FECHADAS = [
  ["A taxa de 7,50% da Doppler é renunciável para um parceiro?", "REFUTADO — não existe override por lançamento nem por integrador."],
  ["A promessa de burn para silenciosamente na migração?", "REFUTADO — a política de beneficiário sobrevive à migração."],
  ["O quote é obrigado a ser WSOL?", "REFUTADO — o quote é parâmetro livre."],
  ["O incinerador é um burn?", "CONFIRMADO que não é. Burn de verdade é um CPI spl_token::burn — e a Doppler não faz nenhum dos dois."],
  ["xStocks: transfer hook T2022 inicializado e desligado?", "CONFIRMADO, e pior do que foi reportado."],
];

/** Os números que só existem depois do lançamento. Nenhum deles é zero hoje. */
const AINDA_NAO = [
  ["Tokens lançados", "nenhum programa na cadeia"],
  ["Pares de equity ativos", "o marketplace é mockup"],
  ["Política escolhida · burn vs split", "nada foi deployado"],
  ["Volume negociado", "não há pool real"],
  ["Taxas queimadas", "burn exige programa próprio, ainda não escrito"],
];

export default async function BurnDownPage() {
  const project = await getActiveProject();
  // A flag guarda o MENU; sem isto ela não guardaria a rota, e a mesma tela
  // responderia por URL direta em todo portal — inclusive nos que acabaram de
  // deixar de mostrá-la. É o mesmo portão que /about, /portfolio e /org-chart
  // já usam.
  if (!project.burnDown) notFound();
  const [repo, mockup] = await Promise.all([lerRepo(), lerMockup()]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={project.name}
        title="BurnDownWallStreet"
        description="Lançador de token e marketplace na Solana onde todo token nasce pareado contra uma ação tokenizada, e a política de taxa é escolhida uma vez, no deploy, e vira imutável na cadeia."
      />

      {/* ── O teto honesto ──
          Vem primeiro porque é o fato que define o produto, e porque é o fato
          que um painel de projeto novo mais gostaria de esconder. A própria
          home do produto diz isso; a nossa não vai dizer menos. */}
      <section className="overflow-hidden rounded-2xl border border-danger/40 bg-surface">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-border bg-danger/10 px-5 py-5">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
              <Flame className="h-3 w-3" /> O teto honesto
            </p>
            <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-foreground">{TETO_HONESTO}%</p>
            <p className="text-xs text-foreground-muted">das taxas, no máximo</p>
          </div>
          <p className="min-w-[18rem] flex-1 text-sm leading-relaxed text-foreground-muted">
            A Doppler leva <strong className="text-foreground">7,50% de toda taxa de negociação</strong> antes de
            qualquer outro, e esse corte <strong className="text-foreground">não é renunciável</strong> — não existe
            override por lançamento nem por integrador. Então{" "}
            <strong className="text-danger">não existe configuração em que &ldquo;100% das taxas queimadas&rdquo; seja verdade</strong>.
            Confirmado na cadeia, não na documentação: a página de taxas da Doppler para Solana é um stub vazio e os
            programas são fechados.
          </p>
        </div>
        <p className="px-5 py-3 text-[11px] leading-relaxed text-foreground-subtle">
          E tem uma segunda consequência que muda o roadmap:{" "}
          <strong className="text-foreground">queimar exige programa próprio</strong>. A Doppler não tem burn em lugar
          nenhum, e o incinerador não é um burn em ativo Token-2022 — burn de verdade é um CPI{" "}
          <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[10px]">spl_token::burn</code>.
        </p>
      </section>

      {/* ── Fase ── */}
      <Section title="Onde o projeto está" hint="fase 0 · pesquisa e design prontos, nada na cadeia">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Fase</p>
            <p className="mt-1 text-lg font-semibold text-foreground">0 — mockup funcional</p>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground-subtle">
              Roda local, nenhuma chamada de cadeia. Tudo abaixo de <code className="font-mono">MarketSource</code> é
              mockado, e o botão de deploy é deliberadamente morto.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Último commit</p>
            {isOk(repo) ? (
              <>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {dias(repo.value.ultimoPush)} dia{dias(repo.value.ultimoPush) === 1 ? "" : "s"} atrás
                </p>
                <p className="mt-1 font-mono text-[11px] text-foreground-subtle">
                  {quando(repo.value.ultimoPush)} · {repo.value.branchPadrao}
                  {repo.value.privado ? " · repo privado" : ""}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-warning">
                ⚠ Não deu para ler o repositório — {repo.state === "unread" ? repo.reason : repo.note}. Isto NÃO quer
                dizer que ele está parado.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Mockup no ar</p>
            {isOk(mockup) ? (
              <>
                <p className={`mt-1 text-lg font-semibold ${mockup.value.status < 400 ? "text-success" : "text-warning"}`}>
                  HTTP {mockup.value.status}
                </p>
                <a
                  href={BURNDOWN.mockup}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-mono text-[11px] text-accent hover:underline"
                >
                  burndownwallstreet.vercel.app <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-warning">
                ⚠ Não consegui alcançar o mockup — {mockup.state === "unread" ? mockup.reason : mockup.note}. Isto NÃO
                quer dizer que ele caiu.
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ── As perguntas abertas ── */}
      <Section title="O que a cadeia ainda não respondeu" hint="ordenado pelo quanto cada uma pode matar">
        <ul className="space-y-2">
          {ABERTAS.map((q) => (
            <li
              key={q.id}
              className={`rounded-2xl border bg-surface p-4 ${q.mata ? "border-danger/40" : "border-border"}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                    q.mata ? "bg-danger/15 text-danger" : "bg-surface-elevated text-foreground-muted"
                  }`}
                >
                  {q.id}
                </span>
                <span className="text-sm font-semibold text-foreground">{q.titulo}</span>
                {q.mata && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-danger">
                    <TriangleAlert className="h-3 w-3" /> pode matar o produto
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-muted">{q.corpo}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── O que já foi respondido ── */}
      <Section title="O que a cadeia já respondeu" hint="decodificado da mainnet, não lido da documentação">
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {FECHADAS.map(([p, r]) => (
            <li key={p} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-[16rem] flex-1 text-xs text-foreground-muted">{p}</span>
              <span className="text-xs font-medium text-foreground">{r}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
          Os programas da Doppler para Solana são fechados e a página de taxas dela é um stub vazio — nada disso veio
          de documentação. Foi decodificado dos codecs gerados pelo SDK mais o estado das contas na mainnet.
        </p>
      </Section>

      {/* ── O que ainda não existe ──
          A parte mais importante do painel. Cada uma destas linhas seria um
          zero num dashboard comum, e um zero aqui afirmaria que o produto
          rodou e não rendeu — quando o que houve é que ele ainda não rodou. */}
      <Section title="O que ainda não existe" hint="nenhum destes é zero — é ausência">
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface-elevated">
          {AINDA_NAO.map(([rot, motivo]) => (
            <li key={rot} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-[14rem] flex-1 text-xs font-medium text-foreground">{rot}</span>
              <span className="font-mono text-lg text-foreground-faint">—</span>
              <span className="text-[11px] text-foreground-subtle">{motivo}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── Onde as coisas estão ── */}
      <Section title="Onde as coisas estão">
        <div className="flex flex-wrap gap-2">
          {[
            { rot: "Repositório", url: `https://github.com/${BURNDOWN.repo}`, icone: GitBranch },
            { rot: "Mockup", url: BURNDOWN.mockup, icone: ExternalLink },
            { rot: "Pesquisa da Doppler", url: `https://github.com/${BURNDOWN.repo}/tree/main/research`, icone: FlaskConical },
            { rot: "Perguntas abertas", url: `https://github.com/${BURNDOWN.repo}/blob/main/research/OPEN-QUESTIONS.md`, icone: FlaskConical },
            { rot: "Spec de design", url: `https://github.com/${BURNDOWN.repo}/blob/main/design/REGISTRY-SPEC.md`, icone: GitBranch },
          ].map(({ rot, url, icone: Icone }) => (
            <a
              key={rot}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
            >
              <Icone className="h-3.5 w-3.5" /> {rot} <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
