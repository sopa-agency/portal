import { Landmark, Wallet, Repeat, Cog, Infinity as InfinityIcon, Shield, Users2, LineChart, ListChecks } from "lucide-react";

// SOPA financial plan — a study/proposal for turning the net liquid treasury
// into a self-sustaining (endowment) model on Base: an Orçamento bucket
// (staked, drawn on demand), a Superstaking bucket (SuperVault: staked +
// streaming the yield), and operational costs. Read-only reference for the
// team; mirrors the design doc. Portal tokens only (light + dark).

const BUCKETS = [
  {
    n: "Bucket 1",
    name: "Orçamento",
    tag: "staked · saque pontual",
    icon: Wallet,
    tone: "sky",
    body: "Capital de giro staked (rendendo) que a SOPA saca sob demanda para pagamentos avulsos — ex.: um salário fora de job. Fica staked, mas não é streamado.",
    chips: ["Aave v3", "Morpho"],
  },
  {
    n: "Bucket 2",
    name: "Superstaking",
    tag: "staking + streaming",
    icon: Repeat,
    tone: "emerald",
    body: "O SuperVault: principal staked rendendo ~4–7% a.a. e o próprio yield saindo como stream contínuo pro time. Poupança e pagamento recorrente na mesma posição.",
    chips: ["SuperVault", "Morpho", "GDA pool"],
  },
  {
    n: "Bucket 3",
    name: "Custos operacionais",
    tag: "runway líquido",
    icon: Cog,
    tone: "amber",
    body: "Caixa líquido para infra, ferramentas e imprevistos — já rastreado hoje no painel de custos fixos.",
    chips: ["Safe (líquido)", "FixedCost"],
  },
] as const;

const TONE: Record<string, { text: string; border: string; bg: string; chip: string }> = {
  sky: { text: "text-sky-600 dark:text-sky-400", border: "border-t-sky-500", bg: "bg-sky-500/5", chip: "border-sky-500/40 text-sky-600 dark:text-sky-400" },
  emerald: { text: "text-emerald-600 dark:text-emerald-400", border: "border-t-emerald-500", bg: "bg-emerald-500/5", chip: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  amber: { text: "text-amber-600 dark:text-amber-400", border: "border-t-amber-500", bg: "bg-amber-500/5", chip: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
};

const SCENARIOS = [
  { cost: "US$ 40k", apy: "5%", principal: "US$ 800k" },
  { cost: "US$ 60k", apy: "5%", principal: "US$ 1,2M" },
  { cost: "US$ 100k", apy: "4%", principal: "US$ 2,5M" },
];

const STREAM_PROTOCOLS = [
  { name: "Superfluid", pick: true, model: "Fluxo perpétuo (tokens/seg)", strong: "Salário contínuo + SuperVault (yield)", weights: "Nativo via pools GDA (units)" },
  { name: "Sablier", pick: false, model: "Início/fim, cliff, curvas", strong: "Vesting, grants, contrato com prazo", weights: "1 stream por pessoa (bulk ~280/tx)" },
  { name: "LlamaPay", pick: false, model: "Por segundo, saque livre", strong: "Simplicidade, gas baixo, sem fee", weights: "1 stream por pessoa" },
];

const GUARDRAILS = [
  ["Saque conservador", "Streamar a uma taxa abaixo do APY real (ex.: sacar 4% mesmo rendendo 6%). A sobra recompõe o principal — absorve a volatilidade do yield."],
  ["Colchão (buffer)", "O rendimento acumula primeiro num super token; o stream saca do colchão. Uma queda temporária de APY não corta a folha."],
  ["Auto-wrap", "O Superfluid re-embrulha o token para o saldo do stream nunca chegar a zero — se zera, o stream é encerrado e o depósito penalizado. É o 'nunca acabar' literal do protocolo."],
  ["Auto-rebalance", "Um keeper/cron varre o yield realizado para o colchão, recompõe o piso de custos e devolve o excedente ao principal."],
];

const PHASES = [
  ["Rótulos + alvos, zero on-chain novo", "Definir os pesos dos 3 buckets e mostrar a alocação na página de tesouro só com os saldos que já lemos. Valida o modelo sem risco."],
  ["Stakar o principal (Orçamento + Superstaking)", "Depositar as reservas produtivas no Morpho/Aave via Safe App. Mostrar principal + APY + yield acumulado reusando os gráficos de receita."],
  ["Streaming do time (pool GDA)", "Criar a pool do Superfluid, cadastrar membros com pesos no portal, abrir o fluxo. Pessoas passam a acumular por segundo."],
  ["Stream direto do yield (perpetuidade)", "Migrar o fluxo para sair do rendimento do stake (SuperVault), capado abaixo do APY, com colchão + auto-wrap. Gasta o juro, nunca o principal."],
];

const DECISIONS = [
  ["Taxa de saque sustentável", "A % do principal que a folha pode consumir por ano sem encolher o caixa (ex.: 4%). É a trava da perpetuidade."],
  ["Pesos dos buckets", "E o piso de reserva intocável, em meses de custo."],
  ["Moeda base do streaming", "USDC puro, ou um super token com yield embutido?"],
  ["Risco do lending", "Aave (conservador) vs. Morpho (rende mais, curadoria a avaliar)."],
  ["Threshold do multisig", "Por tipo de ação — mover principal vs. ajustar payroll."],
  ["Quem entra no stream", "Com que peso — e se colaboradores pontuais vão por Sablier (com prazo) em vez da pool."],
];

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="rounded-md border border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-foreground-faint">{n}</span>
      <h3 className="text-base font-semibold tracking-tight text-foreground">{children}</h3>
    </div>
  );
}

export function FinancialPlan() {
  return (
    <div className="space-y-10">
      {/* Thesis */}
      <header className="rounded-2xl border border-border bg-surface p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground-faint">Plano financeiro · estudo p/ o time</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">Um tesouro da SOPA que nunca acaba</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-muted">
          A meta é um caixa que se sustenta sozinho — a agência gasta só o <strong className="text-foreground">rendimento</strong>, nunca o principal.
          Um único Safe multisig na Base separa o caixa em três funções e mantém os pagamentos correndo por segundo a partir do juro, não do saldo.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["Base L2", "Safe multisig", "Superfluid · Sablier", "Morpho · Aave · Moonwell", "Rascunho p/ discussão"].map((t, i) => (
            <span key={t} className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${i === 0 ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted"}`}>{t}</span>
          ))}
        </div>
      </header>

      {/* Buckets */}
      <section>
        <Eyebrow n="01"><span className="inline-flex items-center gap-2"><Landmark className="h-4 w-4 text-accent" /> O modelo — 3 buckets</span></Eyebrow>
        <p className="mb-4 max-w-2xl text-sm text-foreground-muted">
          O caixa líquido é dividido em três funções. O mesmo Safe é dono dos três; a separação é contábil e por contrato, não em três carteiras diferentes.
          Os dois primeiros ficam staked (rendendo) — a diferença é <em>como</em> pagam.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {BUCKETS.map((b) => {
            const t = TONE[b.tone];
            const Icon = b.icon;
            return (
              <div key={b.n} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
                <div className={`border-t-[3px] ${t.border} p-4`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${t.text}`} />
                    <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${t.text}`}>{b.n}</span>
                  </div>
                  <h4 className="mt-1.5 text-base font-semibold text-foreground">{b.name}</h4>
                  <p className="font-mono text-[11px] text-foreground-faint">{b.tag}</p>
                </div>
                <p className="flex-1 px-4 text-sm text-foreground-muted">{b.body}</p>
                <div className={`mt-3 flex flex-wrap gap-1.5 border-t border-border p-3 ${t.bg}`}>
                  {b.chips.map((c) => (
                    <span key={c} className={`rounded-md border bg-surface px-2 py-0.5 font-mono text-[10px] ${t.chip}`}>{c}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/5 p-3.5 text-sm text-foreground">
          ↺ <strong className="text-emerald-600 dark:text-emerald-400">Os dois primeiros ficam staked</strong> (rendendo). O <strong>Superstaking</strong> streama o próprio yield pro time, contínuo; o <strong>Orçamento</strong> você saca sob demanda pra pagamentos avulsos. O principal do Superstaking nunca é gasto — sai só o juro.
        </div>
      </section>

      {/* Perpetuity rule */}
      <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6">
        <div className="flex items-center gap-2">
          <InfinityIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">A regra da perpetuidade</span>
        </div>
        <p className="mt-2 max-w-2xl text-lg font-semibold tracking-tight text-foreground">
          Gaste só o rendimento. Se o fluxo de pagamentos ≤ o juro que o principal gera, o caixa nunca encolhe.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-foreground-muted">É o mesmo princípio de um fundo patrimonial (endowment). O principal que torna a folha eterna é uma conta direta:</p>
        <div className="my-3 inline-block rounded-lg border border-border bg-surface px-3.5 py-2 font-mono text-sm text-foreground">principal necessário = custo anual ÷ APY</div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-surface-elevated">
                {["Custo do time / ano", "APY (conservador)", "Principal p/ ser eterno"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-foreground-faint ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s.cost} className="border-t border-border">
                  <td className="px-4 py-2.5 text-foreground-muted">{s.cost}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground-muted">{s.apy}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{s.principal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-foreground-muted">Enquanto o principal não chega lá, a folha sai parte do juro, parte do caixa — e a <strong className="text-foreground">receita da SOPA</strong> (jobs + 50% dos splits) engorda o principal até o juro cobrir tudo. A partir daí, autossustentável e só cresce.</p>
      </section>

      {/* Bucket 1 — Orçamento */}
      <section>
        <Eyebrow n="02">Bucket 1 — Orçamento (staked, saque pontual)</Eyebrow>
        <p className="mb-4 max-w-2xl text-sm text-foreground-muted">
          O capital de giro da agência: banca pagamentos <em>avulsos</em> que a SOPA faz direto — ex.: um salário fora de um job, um bônus, uma contratação pontual. Aqui não tem stream: o Safe saca e transfere quando precisa. Fica staked (Aave/Morpho) rendendo enquanto ocioso, mas é um pote de trabalho, reposto pela receita — não um fundo perpétuo.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-foreground">Pra que serve</h4>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              <li>• Salário fora de job — pagamento direto da SOPA.</li>
              <li>• Bônus, adiantamentos, contratações pontuais.</li>
              <li>• Qualquer saída discreta, não recorrente nem streamada.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-foreground">Como funciona</h4>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              <li>• Fica em lending (Aave/Morpho) rendendo enquanto ocioso.</li>
              <li>• Pagar = sacar do vault + transferir, via Safe.</li>
              <li>• Reposto pela receita; não toca no principal do Superstaking.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Bucket 2 — Superstaking */}
      <section>
        <Eyebrow n="03">Bucket 2 — Superstaking (staking + streaming)</Eyebrow>
        <p className="mb-4 max-w-2xl text-sm text-foreground-muted">
          O motor da perpetuidade: <strong className="text-foreground">uma posição só</strong> que guarda o principal staked <strong className="text-foreground">e</strong> paga o time streamando o rendimento. O <strong className="text-foreground">SuperVault</strong> embrulha um vault Morpho (ERC-4626) — o principal rende ~4–7% a.a. e o juro sai como stream por segundo. O que fica separado é só a distribuição por pessoa (abaixo).
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-foreground">O vault por baixo — onde rende</h4>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              <li>• <strong className="text-foreground">Morpho</strong> — vaults curados na Base, <span className="tabular-nums text-emerald-600 dark:text-emerald-400">~4,1–6,8%</span>; rende mais, risco de curadoria.</li>
              <li>• <strong className="text-foreground">Aave v3</strong> — o mais consolidado, <span className="tabular-nums text-emerald-600 dark:text-emerald-400">~3–6%</span>; risco menor.</li>
              <li>• <strong className="text-foreground">Moonwell</strong> — nativo da Base, <span className="tabular-nums text-emerald-600 dark:text-emerald-400">~4%</span>; UX simples.</li>
            </ul>
            <p className="mt-2 text-[11px] text-foreground-faint">Taxas variam com utilização — faixa, não promessa.</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/40 bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">O stream por cima — como paga</h4>
            <p className="mb-2 text-sm text-foreground-muted"><strong className="text-foreground">Plumbing:</strong> o SuperVault streama o yield pro depositante (o Safe); o Safe repassa pra uma <strong className="text-foreground">pool GDA</strong> que divide por peso entre o time.</p>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              <li>• Principal staked, sacável a qualquer hora.</li>
              <li>• Só o juro flui — o principal não encolhe.</li>
              <li>• 1 stream pra pool paga N pessoas (gas constante).</li>
            </ul>
          </div>
        </div>

        <p className="mb-2 mt-4 text-sm text-foreground-muted">Protocolo de streaming — o SuperVault usa Superfluid; Sablier entra em casos com prazo/cliff:</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-surface-elevated">
                {["Protocolo", "Modelo", "Forte em", "Pesos por pessoa"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-foreground-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STREAM_PROTOCOLS.map((p) => (
                <tr key={p.name} className="border-t border-border align-top">
                  <td className={`px-4 py-2.5 font-medium ${p.pick ? "text-accent" : "text-foreground"}`}>{p.name}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{p.model}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{p.strong}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{p.weights}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
          <h4 className="mb-2 text-sm font-semibold text-foreground">Guardrails pra nunca zerar</h4>
          <ul className="space-y-2 text-sm text-foreground-muted">
            {GUARDRAILS.map(([k, v]) => (
              <li key={k}>• <strong className="text-foreground">{k}.</strong> {v}</li>
            ))}
          </ul>
        </div>
        <div className="mt-3 rounded-xl border-l-[3px] border-danger bg-danger/10 p-3.5 text-sm text-foreground">
          <strong>Cuidado de reserva.</strong> Nem tudo deveria ir para lending. Defina um piso intocável (ex.: 3–6 meses de custo operacional) em USDC líquido no Safe, fora de qualquer protocolo.
        </div>
      </section>

      {/* Bucket 3 — Custos */}
      <section>
        <Eyebrow n="04">Bucket 3 — Custos operacionais</Eyebrow>
        <p className="mb-3 max-w-2xl text-sm text-foreground-muted">
          Caixa líquido para infra (Vercel, Pinata…), ferramentas e imprevistos. Aqui a agência já tem meio caminho andado: o painel de <strong className="text-foreground">custos fixos</strong> (tabela FixedCost + runway) já mede o gasto mensal. Este bucket é “quanto do líquido está reservado pra bancar esse runway” — nada novo on-chain, só um rótulo e um alvo.
        </p>
        <ul className="max-w-2xl space-y-1.5 text-sm text-foreground-muted">
          <li>• Alvo do bucket = N meses × custo mensal atual (do painel de custos).</li>
          <li>• Quando fura o piso, o excedente do yield do Superstaking recompõe.</li>
          <li>• Gasto continua saindo do Safe com aprovação normal do multisig.</li>
        </ul>
      </section>

      {/* Weights & registry */}
      <section>
        <Eyebrow n="05"><span className="inline-flex items-center gap-2"><Users2 className="h-4 w-4 text-accent" /> Pesos por pessoa &amp; registro de quem recebe</span></Eyebrow>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 font-mono text-sm font-semibold text-sky-600 dark:text-sky-400">On-chain — pool GDA</h4>
            <p className="mb-2 text-sm text-foreground-muted">Uma pool do Superfluid onde cada membro detém <span className="font-mono text-xs">units</span> (o peso). O Safe streama <em>para a pool</em>; ela distribui proporcional, por segundo.</p>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              <li>• Ex.: 30u / 20u / 10u → 50% / 33% / 17% do fluxo.</li>
              <li>• Entrar = dar units. Sair = zerar. 1 transação, sem tocar nos outros.</li>
              <li>• Ajustar salário relativo = mudar units.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 font-mono text-sm font-semibold text-accent">Frontend — no portal</h4>
            <p className="mb-2 text-sm text-foreground-muted">A UI mapeia pessoa → endereço → units, reaproveitando o <strong className="text-foreground">roster do time</strong> que o portal já tem.</p>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              <li>• Cadastro: escolhe o membro, define peso, confirma no Safe.</li>
              <li>• Guarda o vínculo membro↔endereço↔units (ex.: PayrollMember).</li>
              <li>• Mostra cada pessoa com o quanto acumulou em tempo real.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Safe */}
      <section>
        <Eyebrow n="06"><span className="inline-flex items-center gap-2"><Shield className="h-4 w-4 text-accent" /> Como o Safe multisig orquestra</span></Eyebrow>
        <p className="mb-3 max-w-2xl text-sm text-foreground-muted">
          O ponto de eficiência: <strong className="text-foreground">configurar exige assinatura do multisig; operar não</strong>. Depois que o stream e o stake estão de pé, correm sozinhos — só assina de novo pra mudar pesos, sacar do stake ou reequilibrar buckets.
        </p>
        <ul className="max-w-2xl space-y-1.5 text-sm text-foreground-muted">
          <li>• <strong className="text-foreground">Safe Apps</strong> — Superfluid e Sablier rodam dentro do Safe; a tx é montada lá e assinada pelo threshold (ex.: 2-de-3).</li>
          <li>• <strong className="text-foreground">Transaction Builder</strong> — batela várias ações numa tx (aprovar + depositar + criar a pool) e economiza assinaturas.</li>
          <li>• <strong className="text-foreground">Threshold por risco</strong> — mover principal pede quórum maior; ajustar units do payroll pode ter regra mais leve.</li>
        </ul>
      </section>

      {/* Rollout */}
      <section>
        <Eyebrow n="07"><span className="inline-flex items-center gap-2"><LineChart className="h-4 w-4 text-accent" /> Rollout sugerido (do barato ao completo)</span></Eyebrow>
        <div className="rounded-2xl border border-border bg-surface">
          {PHASES.map(([title, desc], i) => (
            <div key={title} className={`flex gap-4 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent font-mono text-sm font-bold text-accent">{i + 1}</span>
              <div>
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                <p className="mt-0.5 text-sm text-foreground-muted">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Decisions */}
      <section>
        <Eyebrow n="08"><span className="inline-flex items-center gap-2"><ListChecks className="h-4 w-4 text-accent" /> Decisões em aberto pra bater</span></Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2">
          {DECISIONS.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-surface p-4">
              <h4 className="text-sm font-semibold text-foreground">{k}</h4>
              <p className="mt-0.5 text-sm text-foreground-muted">{v}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="border-t border-border pt-5 text-xs text-foreground-faint">
        Documento de estudo — não é aconselhamento financeiro. Rendimentos e detalhes de protocolo mudam; confirmar nas docs oficiais antes de mover fundos. Fontes: Superfluid, Sablier, LlamaPay, Aave, Morpho, Moonwell (jul/2026).
      </p>
    </div>
  );
}
