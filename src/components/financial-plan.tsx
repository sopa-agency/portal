"use client";

import { useState, type ReactNode } from "react";
import { Landmark, Wallet, Repeat, Cog, Infinity as InfinityIcon, Shield, Users2, LineChart, ListChecks } from "lucide-react";

// SOPA financial plan — a study/proposal for turning the net liquid treasury
// into a self-sustaining (endowment) model on Base. Read-only reference for the
// team, PT/EN toggle in the corner. Portal tokens only (light + dark).

type Lang = "pt" | "en";

const BUCKET_STYLE = [
  { icon: Wallet, tone: "sky" },
  { icon: Repeat, tone: "emerald" },
  { icon: Cog, tone: "amber" },
] as const;

const TONE: Record<string, { text: string; border: string; bg: string; chip: string }> = {
  sky: { text: "text-sky-600 dark:text-sky-400", border: "border-t-sky-500", bg: "bg-sky-500/5", chip: "border-sky-500/40 text-sky-600 dark:text-sky-400" },
  emerald: { text: "text-emerald-600 dark:text-emerald-400", border: "border-t-emerald-500", bg: "bg-emerald-500/5", chip: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  amber: { text: "text-amber-600 dark:text-amber-400", border: "border-t-amber-500", bg: "bg-amber-500/5", chip: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
};

type Copy = {
  eyebrow: string;
  title: string;
  lead: string;
  tags: string[];
  s01: string;
  s01intro: string;
  buckets: { n: string; name: string; tag: string; body: string; chips: string[] }[];
  feedback: string;
  perpLabel: string;
  perpRule: string;
  perpIntro: string;
  formula: string;
  scenHead: string[];
  scen: string[][];
  perpFoot: string;
  s02: string;
  s02intro: string;
  s02c1: { h: string; items: string[] };
  s02c2: { h: string; items: string[] };
  s03: string;
  s03intro: string;
  vaultH: string;
  vault: { name: string; desc: string; apy: string; tail: string }[];
  vaultNote: string;
  streamH: string;
  streamPlumb: string;
  streamItems: string[];
  protoIntro: string;
  protoHead: string[];
  proto: { name: string; pick: boolean; model: string; strong: string; weights: string }[];
  guardH: string;
  guard: string[][];
  reserve: string;
  s04: string;
  s04intro: string;
  s04items: string[];
  s05: string;
  s05c1h: string;
  s05c1p: string;
  s05c1items: string[];
  s05c2h: string;
  s05c2p: string;
  s05c2items: string[];
  s06: string;
  s06intro: string;
  s06items: string[];
  s07: string;
  phases: string[][];
  s08: string;
  decisions: string[][];
  foot: string;
};

const C: Record<Lang, Copy> = {
  pt: {
    eyebrow: "Plano financeiro · estudo p/ o time",
    title: "Um tesouro da SOPA que nunca acaba",
    lead: "A meta é um caixa que se sustenta sozinho — a agência gasta só o **rendimento**, nunca o principal. Um único Safe multisig na Base separa o caixa em três funções e mantém os pagamentos correndo por segundo a partir do juro, não do saldo.",
    tags: ["Base L2", "Safe multisig", "Superfluid · Sablier", "Morpho · Aave · Moonwell", "Rascunho p/ discussão"],
    s01: "O modelo — 3 buckets",
    s01intro: "O caixa líquido é dividido em três funções. O mesmo Safe é dono dos três; a separação é contábil e por contrato, não em três carteiras diferentes. Os dois primeiros ficam staked (rendendo) — a diferença é *como* pagam.",
    buckets: [
      { n: "Bucket 1", name: "Orçamento", tag: "staked · saque pontual", body: "Capital de giro staked (rendendo) que a SOPA saca sob demanda para pagamentos avulsos — ex.: um salário fora de job. Fica staked, mas não é streamado.", chips: ["Aave v3", "Morpho"] },
      { n: "Bucket 2", name: "Superstaking", tag: "staking + streaming", body: "O SuperVault: principal staked rendendo ~4–7% a.a. e o próprio yield saindo como stream contínuo pro time. Poupança e pagamento recorrente na mesma posição.", chips: ["SuperVault", "Morpho", "GDA pool"] },
      { n: "Bucket 3", name: "Custos operacionais", tag: "runway líquido", body: "Caixa líquido para infra, ferramentas e imprevistos — já rastreado hoje no painel de custos fixos.", chips: ["Safe (líquido)", "FixedCost"] },
    ],
    feedback: "↺ **Os dois primeiros ficam staked** (rendendo). O **Superstaking** streama o próprio yield pro time, contínuo; o **Orçamento** você saca sob demanda pra pagamentos avulsos. O principal do Superstaking nunca é gasto — sai só o juro.",
    perpLabel: "A regra da perpetuidade",
    perpRule: "Gaste só o rendimento. Se o fluxo de pagamentos ≤ o juro que o principal gera, o caixa nunca encolhe.",
    perpIntro: "É o mesmo princípio de um fundo patrimonial (endowment). O principal que torna a folha eterna é uma conta direta:",
    formula: "principal necessário = custo anual ÷ APY",
    scenHead: ["Custo do time / ano", "APY (conservador)", "Principal p/ ser eterno"],
    scen: [["US$ 40k", "5%", "US$ 800k"], ["US$ 60k", "5%", "US$ 1,2M"], ["US$ 100k", "4%", "US$ 2,5M"]],
    perpFoot: "Enquanto o principal não chega lá, a folha sai parte do juro, parte do caixa — e a **receita da SOPA** (jobs + 50% dos splits) engorda o principal até o juro cobrir tudo. A partir daí, autossustentável e só cresce.",
    s02: "Bucket 1 — Orçamento (staked, saque pontual)",
    s02intro: "O capital de giro da agência: banca pagamentos *avulsos* que a SOPA faz direto — ex.: um salário fora de um job, um bônus, uma contratação pontual. Aqui não tem stream: o Safe saca e transfere quando precisa. Fica staked (Aave/Morpho) rendendo enquanto ocioso, mas é um pote de trabalho, reposto pela receita — não um fundo perpétuo.",
    s02c1: { h: "Pra que serve", items: ["Salário fora de job — pagamento direto da SOPA.", "Bônus, adiantamentos, contratações pontuais.", "Qualquer saída discreta, não recorrente nem streamada."] },
    s02c2: { h: "Como funciona", items: ["Fica em lending (Aave/Morpho) rendendo enquanto ocioso.", "Pagar = sacar do vault + transferir, via Safe.", "Reposto pela receita; não toca no principal do Superstaking."] },
    s03: "Bucket 2 — Superstaking (staking + streaming)",
    s03intro: "O motor da perpetuidade: **uma posição só** que guarda o principal staked **e** paga o time streamando o rendimento. O **SuperVault** embrulha um vault Morpho (ERC-4626) — o principal rende ~4–7% a.a. e o juro sai como stream por segundo. O que fica separado é só a distribuição por pessoa (abaixo).",
    vaultH: "O vault por baixo — onde rende",
    vault: [
      { name: "Morpho", desc: "vaults curados na Base, ", apy: "~4,1–6,8%", tail: "; rende mais, risco de curadoria." },
      { name: "Aave v3", desc: "o mais consolidado, ", apy: "~3–6%", tail: "; risco menor." },
      { name: "Moonwell", desc: "nativo da Base, ", apy: "~4%", tail: "; UX simples." },
    ],
    vaultNote: "Taxas variam com utilização — faixa, não promessa.",
    streamH: "O stream por cima — como paga",
    streamPlumb: "**Plumbing:** o SuperVault streama o yield pro depositante (o Safe); o Safe repassa pra uma **pool GDA** que divide por peso entre o time.",
    streamItems: ["Principal staked, sacável a qualquer hora.", "Só o juro flui — o principal não encolhe.", "1 stream pra pool paga N pessoas (gas constante)."],
    protoIntro: "Protocolo de streaming — o SuperVault usa Superfluid; Sablier entra em casos com prazo/cliff:",
    protoHead: ["Protocolo", "Modelo", "Forte em", "Pesos por pessoa"],
    proto: [
      { name: "Superfluid", pick: true, model: "Fluxo perpétuo (tokens/seg)", strong: "Salário contínuo + SuperVault (yield)", weights: "Nativo via pools GDA (units)" },
      { name: "Sablier", pick: false, model: "Início/fim, cliff, curvas", strong: "Vesting, grants, contrato com prazo", weights: "1 stream por pessoa (bulk ~280/tx)" },
      { name: "LlamaPay", pick: false, model: "Por segundo, saque livre", strong: "Simplicidade, gas baixo, sem fee", weights: "1 stream por pessoa" },
    ],
    guardH: "Guardrails pra nunca zerar",
    guard: [
      ["Saque conservador", "Streamar a uma taxa abaixo do APY real (ex.: sacar 4% mesmo rendendo 6%). A sobra recompõe o principal — absorve a volatilidade do yield."],
      ["Colchão (buffer)", "O rendimento acumula primeiro num super token; o stream saca do colchão. Uma queda temporária de APY não corta a folha."],
      ["Auto-wrap", "O Superfluid re-embrulha o token para o saldo do stream nunca chegar a zero — se zera, o stream é encerrado e o depósito penalizado. É o ‘nunca acabar’ literal do protocolo."],
      ["Auto-rebalance", "Um keeper/cron varre o yield realizado para o colchão, recompõe o piso de custos e devolve o excedente ao principal."],
    ],
    reserve: "**Cuidado de reserva.** Nem tudo deveria ir para lending. Defina um piso intocável (ex.: 3–6 meses de custo operacional) em USDC líquido no Safe, fora de qualquer protocolo.",
    s04: "Bucket 3 — Custos operacionais",
    s04intro: "Caixa líquido para infra (Vercel, Pinata…), ferramentas e imprevistos. Aqui a agência já tem meio caminho andado: o painel de **custos fixos** (tabela FixedCost + runway) já mede o gasto mensal. Este bucket é “quanto do líquido está reservado pra bancar esse runway” — nada novo on-chain, só um rótulo e um alvo.",
    s04items: ["Alvo do bucket = N meses × custo mensal atual (do painel de custos).", "Quando fura o piso, o excedente do yield do Superstaking recompõe.", "Gasto continua saindo do Safe com aprovação normal do multisig."],
    s05: "Pesos por pessoa & registro de quem recebe",
    s05c1h: "On-chain — pool GDA",
    s05c1p: "Uma pool do Superfluid onde cada membro detém *units* (o peso). O Safe streama *para a pool*; ela distribui proporcional, por segundo.",
    s05c1items: ["Ex.: 30u / 20u / 10u → 50% / 33% / 17% do fluxo.", "Entrar = dar units. Sair = zerar. 1 transação, sem tocar nos outros.", "Ajustar salário relativo = mudar units."],
    s05c2h: "Frontend — no portal",
    s05c2p: "A UI mapeia pessoa → endereço → units, reaproveitando o **roster do time** que o portal já tem.",
    s05c2items: ["Cadastro: escolhe o membro, define peso, confirma no Safe.", "Guarda o vínculo membro↔endereço↔units (ex.: PayrollMember).", "Mostra cada pessoa com o quanto acumulou em tempo real."],
    s06: "Como o Safe multisig orquestra",
    s06intro: "O ponto de eficiência: **configurar exige assinatura do multisig; operar não**. Depois que o stream e o stake estão de pé, correm sozinhos — só assina de novo pra mudar pesos, sacar do stake ou reequilibrar buckets.",
    s06items: ["**Safe Apps** — Superfluid e Sablier rodam dentro do Safe; a tx é montada lá e assinada pelo threshold (ex.: 2-de-3).", "**Transaction Builder** — batela várias ações numa tx (aprovar + depositar + criar a pool) e economiza assinaturas.", "**Threshold por risco** — mover principal pede quórum maior; ajustar units do payroll pode ter regra mais leve."],
    s07: "Rollout sugerido (do barato ao completo)",
    phases: [
      ["Rótulos + alvos, zero on-chain novo", "Definir os pesos dos 3 buckets e mostrar a alocação na página de tesouro só com os saldos que já lemos. Valida o modelo sem risco."],
      ["Stakar o principal (Orçamento + Superstaking)", "Depositar as reservas produtivas no Morpho/Aave via Safe App. Mostrar principal + APY + yield acumulado reusando os gráficos de receita."],
      ["Streaming do time (pool GDA)", "Criar a pool do Superfluid, cadastrar membros com pesos no portal, abrir o fluxo. Pessoas passam a acumular por segundo."],
      ["Stream direto do yield (perpetuidade)", "Migrar o fluxo para sair do rendimento do stake (SuperVault), capado abaixo do APY, com colchão + auto-wrap. Gasta o juro, nunca o principal."],
    ],
    s08: "Decisões em aberto pra bater",
    decisions: [
      ["Taxa de saque sustentável", "A % do principal que a folha pode consumir por ano sem encolher o caixa (ex.: 4%). É a trava da perpetuidade."],
      ["Pesos dos buckets", "E o piso de reserva intocável, em meses de custo."],
      ["Moeda base do streaming", "USDC puro, ou um super token com yield embutido?"],
      ["Risco do lending", "Aave (conservador) vs. Morpho (rende mais, curadoria a avaliar)."],
      ["Threshold do multisig", "Por tipo de ação — mover principal vs. ajustar payroll."],
      ["Quem entra no stream", "Com que peso — e se colaboradores pontuais vão por Sablier (com prazo) em vez da pool."],
    ],
    foot: "Documento de estudo — não é aconselhamento financeiro. Rendimentos e detalhes de protocolo mudam; confirmar nas docs oficiais antes de mover fundos. Fontes: Superfluid, Sablier, LlamaPay, Aave, Morpho, Moonwell (jul/2026).",
  },
  en: {
    eyebrow: "Financial plan · study for the team",
    title: "A SOPA treasury that never runs out",
    lead: "The goal is a treasury that sustains itself — the agency spends only the **yield**, never the principal. A single Safe multisig on Base splits the cash into three functions and keeps payments streaming by the second out of the interest, not the balance.",
    tags: ["Base L2", "Safe multisig", "Superfluid · Sablier", "Morpho · Aave · Moonwell", "Draft for discussion"],
    s01: "The model — 3 buckets",
    s01intro: "The liquid cash is split into three functions. The same Safe owns all three; the split is accounting- and contract-level, not three separate wallets. The first two stay staked (earning) — the difference is *how* they pay.",
    buckets: [
      { n: "Bucket 1", name: "Budget", tag: "staked · on-demand", body: "Staked working capital (earning) that SOPA withdraws on demand for one-off payments — e.g. a salary outside a job. Stays staked, but is not streamed.", chips: ["Aave v3", "Morpho"] },
      { n: "Bucket 2", name: "Superstaking", tag: "staking + streaming", body: "The SuperVault: principal staked earning ~4–7% APY, and the yield itself going out as a continuous stream to the team. Savings and recurring payment in one position.", chips: ["SuperVault", "Morpho", "GDA pool"] },
      { n: "Bucket 3", name: "Operational costs", tag: "liquid runway", body: "Liquid cash for infra, tooling and contingencies — already tracked today in the fixed-costs panel.", chips: ["Safe (liquid)", "FixedCost"] },
    ],
    feedback: "↺ **The first two stay staked** (earning). **Superstaking** streams its own yield to the team, continuously; the **Budget** you withdraw on demand for one-off payments. Superstaking's principal is never spent — only the interest goes out.",
    perpLabel: "The perpetuity rule",
    perpRule: "Spend only the yield. If the payment flow ≤ the interest the principal generates, the cash never shrinks.",
    perpIntro: "It's the same principle as an endowment fund. The principal that makes payroll eternal is a simple calculation:",
    formula: "principal needed = annual cost ÷ APY",
    scenHead: ["Team cost / year", "APY (conservative)", "Principal to be eternal"],
    scen: [["US$ 40k", "5%", "US$ 800k"], ["US$ 60k", "5%", "US$ 1.2M"], ["US$ 100k", "4%", "US$ 2.5M"]],
    perpFoot: "Until the principal gets there, payroll comes partly from interest, partly from cash — and **SOPA's revenue** (jobs + 50% of the splits) grows the principal until interest covers everything. From then on, self-sustaining and only grows.",
    s02: "Bucket 1 — Budget (staked, on-demand)",
    s02intro: "The agency's working capital: it funds *one-off* payments SOPA makes directly — e.g. a salary outside a job, a bonus, a one-time hire. No streaming here: the Safe withdraws and transfers when needed. It stays staked (Aave/Morpho) earning while idle, but it's a working pot, replenished by revenue — not a perpetual fund.",
    s02c1: { h: "What it's for", items: ["Salary outside a job — paid directly by SOPA.", "Bonuses, advances, one-time hires.", "Any discrete outflow, neither recurring nor streamed."] },
    s02c2: { h: "How it works", items: ["Sits in lending (Aave/Morpho) earning while idle.", "Paying = withdraw from the vault + transfer, via Safe.", "Replenished by revenue; doesn't touch Superstaking's principal."] },
    s03: "Bucket 2 — Superstaking (staking + streaming)",
    s03intro: "The perpetuity engine: **a single position** that holds the principal staked **and** pays the team by streaming the yield. The **SuperVault** wraps a Morpho vault (ERC-4626) — the principal earns ~4–7% APY and the interest goes out as a per-second stream. What stays separate is only the per-person distribution (below).",
    vaultH: "The vault underneath — where it earns",
    vault: [
      { name: "Morpho", desc: "curated vaults on Base, ", apy: "~4.1–6.8%", tail: "; higher yield, curator risk." },
      { name: "Aave v3", desc: "the most established, ", apy: "~3–6%", tail: "; lower risk." },
      { name: "Moonwell", desc: "Base-native, ", apy: "~4%", tail: "; simple UX." },
    ],
    vaultNote: "Rates vary with utilization — a range, not a promise.",
    streamH: "The stream on top — how it pays",
    streamPlumb: "**Plumbing:** the SuperVault streams the yield to the depositor (the Safe); the Safe forwards it to a **GDA pool** that splits it by weight across the team.",
    streamItems: ["Principal staked, withdrawable anytime.", "Only the interest flows — the principal doesn't shrink.", "1 stream to the pool pays N people (constant gas)."],
    protoIntro: "Streaming protocol — the SuperVault uses Superfluid; Sablier fits cases with a term/cliff:",
    protoHead: ["Protocol", "Model", "Strong at", "Per-person weights"],
    proto: [
      { name: "Superfluid", pick: true, model: "Perpetual flow (tokens/sec)", strong: "Continuous salary + SuperVault (yield)", weights: "Native via GDA pools (units)" },
      { name: "Sablier", pick: false, model: "Start/end, cliff, curves", strong: "Vesting, grants, fixed-term contracts", weights: "1 stream per person (bulk ~280/tx)" },
      { name: "LlamaPay", pick: false, model: "Per second, free withdrawal", strong: "Simplicity, low gas, no fee", weights: "1 stream per person" },
    ],
    guardH: "Guardrails to never hit zero",
    guard: [
      ["Conservative draw", "Stream at a rate below the real APY (e.g. draw 4% while earning 6%). The surplus rebuilds the principal — absorbs yield volatility."],
      ["Buffer", "Yield accrues first into a super token; the stream draws from the buffer. A temporary APY dip won't cut payroll."],
      ["Auto-wrap", "Superfluid re-wraps the token so the stream balance never hits zero — if it does, the stream is closed and the deposit penalized. It's the literal ‘never runs out’ of the protocol."],
      ["Auto-rebalance", "A keeper/cron sweeps realized yield into the buffer, tops up the cost floor and returns the surplus to the principal."],
    ],
    reserve: "**Reserve caution.** Not everything should go into lending. Set an untouchable floor (e.g. 3–6 months of operating cost) in liquid USDC in the Safe, outside any protocol.",
    s04: "Bucket 3 — Operational costs",
    s04intro: "Liquid cash for infra (Vercel, Pinata…), tooling and contingencies. Here the agency is halfway there: the **fixed-costs** panel (FixedCost table + runway) already measures monthly spend. This bucket is “how much of the liquid is reserved to fund that runway” — nothing new on-chain, just a label and a target.",
    s04items: ["Bucket target = N months × current monthly cost (from the costs panel).", "When it breaches the floor, Superstaking's yield surplus tops it up.", "Spending still leaves the Safe with normal multisig approval."],
    s05: "Per-person weights & who-gets-paid registry",
    s05c1h: "On-chain — GDA pool",
    s05c1p: "A Superfluid pool where each member holds *units* (the weight). The Safe streams *into the pool*; it distributes proportionally, per second.",
    s05c1items: ["E.g. 30u / 20u / 10u → 50% / 33% / 17% of the flow.", "Join = grant units. Leave = zero them. 1 tx, without touching the others.", "Adjust relative salary = change units."],
    s05c2h: "Frontend — in the portal",
    s05c2p: "The UI maps person → address → units, reusing the **team roster** the portal already has.",
    s05c2items: ["Setup: pick the member, set the weight, confirm in the Safe.", "Store the member↔address↔units link (e.g. PayrollMember).", "Show each person with how much they've accrued in real time."],
    s06: "How the Safe multisig orchestrates",
    s06intro: "The efficiency point: **configuring requires a multisig signature; operating doesn't**. Once the stream and stake are set up, they run on their own — you only sign again to change weights, withdraw from the stake or rebalance buckets.",
    s06items: ["**Safe Apps** — Superfluid and Sablier run inside the Safe; the tx is built there and signed by the threshold (e.g. 2-of-3).", "**Transaction Builder** — batches several actions into one tx (approve + deposit + create the pool) and saves signatures.", "**Risk-based threshold** — moving principal needs a bigger quorum; adjusting payroll units can have a lighter rule."],
    s07: "Suggested rollout (cheapest to complete)",
    phases: [
      ["Labels + targets, zero new on-chain", "Define the 3 buckets' weights and show the allocation on the treasury page using only the balances we already read. Validates the model risk-free."],
      ["Stake the principal (Budget + Superstaking)", "Deposit the productive reserves into Morpho/Aave via Safe App. Show principal + APY + accrued yield reusing the revenue charts."],
      ["Stream the team (GDA pool)", "Create the Superfluid pool, register members with weights in the portal, open the flow. People start accruing by the second."],
      ["Stream straight from the yield (perpetuity)", "Migrate the flow to come out of the stake's yield (SuperVault), capped below APY, with buffer + auto-wrap. Spends the interest, never the principal."],
    ],
    s08: "Open decisions to settle",
    decisions: [
      ["Sustainable draw rate", "The % of principal payroll can consume per year without shrinking the cash (e.g. 4%). It's the perpetuity lock."],
      ["Bucket weights", "And the untouchable reserve floor, in months of cost."],
      ["Streaming base currency", "Plain USDC, or a super token with built-in yield?"],
      ["Lending risk", "Aave (conservative) vs. Morpho (higher yield, curator to assess)."],
      ["Multisig threshold", "By action type — moving principal vs. adjusting payroll."],
      ["Who joins the stream", "At what weight — and whether one-off contributors go via Sablier (with a term) instead of the pool."],
    ],
    foot: "Study document — not financial advice. Yields and protocol details change; confirm in the official docs before moving funds. Sources: Superfluid, Sablier, LlamaPay, Aave, Morpho, Moonwell (Jul 2026).",
  },
};

// Render a string with **bold** and *italic* segments into JSX.
function rich(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-foreground">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

function Eyebrow({ n, icon: Icon, children }: { n: string; icon?: typeof Landmark; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="rounded-md border border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-foreground-faint">{n}</span>
      <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
        {Icon ? <Icon className="h-4 w-4 text-accent" /> : null}
        {children}
      </h3>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-foreground-muted">
      {items.map((it, i) => (
        <li key={i}>• {rich(it)}</li>
      ))}
    </ul>
  );
}

export function FinancialPlan() {
  const [lang, setLang] = useState<Lang>("pt");
  const t = C[lang];

  return (
    <div className="space-y-10">
      {/* Thesis + language toggle in the corner */}
      <header className="relative rounded-2xl border border-border bg-surface p-6">
        <div className="absolute right-4 top-4 flex overflow-hidden rounded-lg border border-border">
          {(["pt", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`px-2.5 py-1 font-mono text-[11px] font-semibold uppercase transition-colors ${
                lang === l ? "bg-accent-bg text-accent" : "bg-surface text-foreground-faint hover:text-foreground"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground-faint">{t.eyebrow}</p>
        <h2 className="mt-2 max-w-2xl pr-16 text-2xl font-bold tracking-tight text-foreground">{t.title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-muted">{rich(t.lead)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {t.tags.map((tag, i) => (
            <span key={tag} className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${i === 0 ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted"}`}>{tag}</span>
          ))}
        </div>
      </header>

      {/* Buckets */}
      <section>
        <Eyebrow n="01" icon={Landmark}>{t.s01}</Eyebrow>
        <p className="mb-4 max-w-2xl text-sm text-foreground-muted">{rich(t.s01intro)}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {t.buckets.map((b, i) => {
            const style = BUCKET_STYLE[i];
            const tone = TONE[style.tone];
            const Icon = style.icon;
            return (
              <div key={b.n} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
                <div className={`border-t-[3px] ${tone.border} p-4`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${tone.text}`} />
                    <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${tone.text}`}>{b.n}</span>
                  </div>
                  <h4 className="mt-1.5 text-base font-semibold text-foreground">{b.name}</h4>
                  <p className="font-mono text-[11px] text-foreground-faint">{b.tag}</p>
                </div>
                <p className="flex-1 px-4 text-sm text-foreground-muted">{b.body}</p>
                <div className={`mt-3 flex flex-wrap gap-1.5 border-t border-border p-3 ${tone.bg}`}>
                  {b.chips.map((c) => (
                    <span key={c} className={`rounded-md border bg-surface px-2 py-0.5 font-mono text-[10px] ${tone.chip}`}>{c}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/5 p-3.5 text-sm text-foreground">{rich(t.feedback)}</div>
      </section>

      {/* Perpetuity rule */}
      <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6">
        <div className="flex items-center gap-2">
          <InfinityIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">{t.perpLabel}</span>
        </div>
        <p className="mt-2 max-w-2xl text-lg font-semibold tracking-tight text-foreground">{t.perpRule}</p>
        <p className="mt-2 max-w-2xl text-sm text-foreground-muted">{t.perpIntro}</p>
        <div className="my-3 inline-block rounded-lg border border-border bg-surface px-3.5 py-2 font-mono text-sm text-foreground">{t.formula}</div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-surface-elevated">
                {t.scenHead.map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-foreground-faint ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.scen.map((s) => (
                <tr key={s[0]} className="border-t border-border">
                  <td className="px-4 py-2.5 text-foreground-muted">{s[0]}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground-muted">{s[1]}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{s[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-foreground-muted">{rich(t.perpFoot)}</p>
      </section>

      {/* Bucket 1 */}
      <section>
        <Eyebrow n="02">{t.s02}</Eyebrow>
        <p className="mb-4 max-w-2xl text-sm text-foreground-muted">{rich(t.s02intro)}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-foreground">{t.s02c1.h}</h4>
            <Bullets items={t.s02c1.items} />
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-foreground">{t.s02c2.h}</h4>
            <Bullets items={t.s02c2.items} />
          </div>
        </div>
      </section>

      {/* Bucket 2 */}
      <section>
        <Eyebrow n="03">{t.s03}</Eyebrow>
        <p className="mb-4 max-w-2xl text-sm text-foreground-muted">{rich(t.s03intro)}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-foreground">{t.vaultH}</h4>
            <ul className="space-y-1.5 text-sm text-foreground-muted">
              {t.vault.map((v) => (
                <li key={v.name}>• <strong className="text-foreground">{v.name}</strong> — {v.desc}<span className="tabular-nums text-emerald-600 dark:text-emerald-400">{v.apy}</span>{v.tail}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-foreground-faint">{t.vaultNote}</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/40 bg-surface p-5">
            <h4 className="mb-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{t.streamH}</h4>
            <p className="mb-2 text-sm text-foreground-muted">{rich(t.streamPlumb)}</p>
            <Bullets items={t.streamItems} />
          </div>
        </div>

        <p className="mb-2 mt-4 text-sm text-foreground-muted">{t.protoIntro}</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-surface-elevated">
                {t.protoHead.map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-foreground-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.proto.map((p) => (
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
          <h4 className="mb-2 text-sm font-semibold text-foreground">{t.guardH}</h4>
          <ul className="space-y-2 text-sm text-foreground-muted">
            {t.guard.map(([k, v]) => (
              <li key={k}>• <strong className="text-foreground">{k}.</strong> {v}</li>
            ))}
          </ul>
        </div>
        <div className="mt-3 rounded-xl border-l-[3px] border-danger bg-danger/10 p-3.5 text-sm text-foreground">{rich(t.reserve)}</div>
      </section>

      {/* Bucket 3 */}
      <section>
        <Eyebrow n="04">{t.s04}</Eyebrow>
        <p className="mb-3 max-w-2xl text-sm text-foreground-muted">{rich(t.s04intro)}</p>
        <div className="max-w-2xl"><Bullets items={t.s04items} /></div>
      </section>

      {/* Weights */}
      <section>
        <Eyebrow n="05" icon={Users2}>{t.s05}</Eyebrow>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 font-mono text-sm font-semibold text-sky-600 dark:text-sky-400">{t.s05c1h}</h4>
            <p className="mb-2 text-sm text-foreground-muted">{rich(t.s05c1p)}</p>
            <Bullets items={t.s05c1items} />
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h4 className="mb-2 font-mono text-sm font-semibold text-accent">{t.s05c2h}</h4>
            <p className="mb-2 text-sm text-foreground-muted">{rich(t.s05c2p)}</p>
            <Bullets items={t.s05c2items} />
          </div>
        </div>
      </section>

      {/* Safe */}
      <section>
        <Eyebrow n="06" icon={Shield}>{t.s06}</Eyebrow>
        <p className="mb-3 max-w-2xl text-sm text-foreground-muted">{rich(t.s06intro)}</p>
        <div className="max-w-2xl"><Bullets items={t.s06items} /></div>
      </section>

      {/* Rollout */}
      <section>
        <Eyebrow n="07" icon={LineChart}>{t.s07}</Eyebrow>
        <div className="rounded-2xl border border-border bg-surface">
          {t.phases.map(([title, desc], i) => (
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
        <Eyebrow n="08" icon={ListChecks}>{t.s08}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2">
          {t.decisions.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-surface p-4">
              <h4 className="text-sm font-semibold text-foreground">{k}</h4>
              <p className="mt-0.5 text-sm text-foreground-muted">{v}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="border-t border-border pt-5 text-xs text-foreground-faint">{t.foot}</p>
    </div>
  );
}
