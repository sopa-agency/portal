// The treasury page in prose. Every number here is the same live value the
// cards above render — this just says out loud what they add up to, so someone
// can read the state in thirty seconds instead of decoding six panels.
//
// Rule for anything written here: no cheerleading. If money is idle, if the
// stream is symbolic, if a queue is stuck, the text says so.

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/dictionary";

export type BriefingInput = {
  projectName: string;
  /** This project's OWN pot (not the brand treasuries it reports on). */
  ownTreasuryUsd: number;
  /** Every treasury shown on the page, including the brands. */
  combinedTreasuryUsd: number;
  brandCount: number;
  stakedUsd: number | null;
  apy: number | null;
  monthlyYieldUsd: number | null;
  harvestableUsd: number | null;
  streamMonthlyUsd: number | null;
  streamBufferUsd: number;
  streamRunwayDays: number | null;
  memberCount: number;
  connectedCount: number;
  /** Monthly fixed costs booked against THIS project only. */
  ownMonthlyCostsUsd: number;
  /** Monthly fixed costs across every treasury on the page. */
  allMonthlyCostsUsd: number;
  incomingLast6Usd: number;
  jobsLast6Usd: number;
  pendingJobsUsd: number;
  /** Unexecuted Safe transactions, oldest nonce first. */
  queued: { nonce: number; action: string; confirmations: number; required: number }[];
  allocationSaved: boolean;
  /** The community "support" vault (Morpho), when one is deployed for SOPA. */
  vault?: {
    /** Total deposited by backers (excludes the burned dead deposit). */
    depositedUsd: number;
    /** How many wallets are backing it. */
    backers: number;
    /** How many of those backers are team members (vs outsiders). */
    teamBackers: number;
    /** SOPA's accumulated performance fee from the vault so far. */
    sopaEarnedUsd: number;
    /** Gross yield rate of the pot (fraction), or null if unknown. */
    apy: number | null;
    /** Share of the yield taken as the SOPA fee, 0–1. */
    feeToSopa: number;
  };
  /** SOPA's MOR position from the Gnars subnet pipeline (Morpheus). */
  mor?: {
    /** MOR staked into the Gnars subnet (compounding SOPA's cut back in). */
    stakedMor: number;
    /** MOR already collected, sitting idle in SOPA's wallet. */
    walletMor: number;
    /** MOR credited to SOPA but not yet withdrawn (Splits warehouse). */
    pendingMor: number;
    /** Whole-subnet reward still to be claimed by the pipeline (context). */
    subnetPendingMor: number;
  };
};

export type BriefingSection = { title: string; paragraphs: string[] };
export type Briefing = { headline: string; sections: BriefingSection[]; generatedAt: string };

// Numbers are wrapped in a marker so the renderer can emphasize them without
// the generator knowing anything about styling. Prose stays plain text.
export const NUM = "⁣"; // invisible separator — never appears in real copy

const mark = (s: string) => `${NUM}${s}${NUM}`;

const usd = (n: number) =>
  mark(n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : 0 }));

const pct = (n: number) => mark(`${Math.round(n * 100)}%`);

/** MOR amounts stay in MOR units — no reliable price feed, and the honest read
 * is "how much MOR", not a shaky USD conversion of pennies. */
const mor = (n: number) => mark(`${n.toLocaleString("en-US", { maximumFractionDigits: n > 0 && n < 1 ? 4 : 3 })} MOR`);

/** Split a paragraph into plain/emphasized runs for rendering. */
export function briefingRuns(text: string): { text: string; num: boolean }[] {
  return text
    .split(NUM)
    .map((part, i) => ({ text: part, num: i % 2 === 1 }))
    .filter((r) => r.text.length > 0);
}

/** "3 people" / "1 person" — the count is marked, the noun isn't. */
const plural = (n: number, one: string, many: string) => `${mark(String(n))} ${n === 1 ? one : many}`;

/**
 * The prose itself, per language.
 *
 * This copy lives here rather than in `lib/i18n/dictionary` on purpose: it is
 * one continuous argument whose sentences only make sense next to the branch
 * that picks them, and half of them are assembled from two or three fragments.
 * Splitting it into forty dictionary keys would make both files harder to read.
 * Same call the financial-plan study makes with its own PT/EN copy table.
 */
type Copy = {
  sections: {
    cash: string;
    incoming: string;
    outgoing: string;
    payments: string;
    vault: string;
    mor: string;
    attention: string;
  };
  person: { one: string; many: string };
  tx: { one: string; many: string };
  ownCash: (name: string, value: string) => string;
  ownCashOnly: (name: string, value: string) => string;
  brandsToo: (value: string) => string;
  nothingEarning: (value: string) => string;
  staked: (value: string, share: string, rate: string) => string;
  atRate: (apy: string) => string;
  perMonthYield: (value: string) => string;
  idleLeft: (value: string) => string;
  harvestable: (value: string) => string;
  noIncoming: string;
  incomingTotal: (value: string) => string;
  jobsDominant: (share: string) => string;
  jobsMixed: (share: string) => string;
  jobsNone: string;
  pendingJobs: (value: string) => string;
  noCosts: (name: string) => string;
  costsLast: (name: string, value: string, duration: string) => string;
  overTenYears: string;
  aboutMonths: (n: string) => string;
  allPortalCosts: (total: string, diff: string) => string;
  noPool: string;
  poolIdle: (people: string) => string;
  streaming: (value: string, people: string) => string;
  symbolicFlow: string;
  yieldCovers: (value: string) => string;
  yieldShort: (value: string) => string;
  connectedCount: (connected: string, total: string) => string;
  bufferRunway: (buffer: string, days: string) => string;
  vaultEmpty: string;
  vaultTotal: (value: string, people: string, apy: string, fee: string, monthly: string) => string;
  vaultMonthly: (value: string) => string;
  vaultEarned: (value: string) => string;
  vaultTeamOnly: string;
  morNone: string;
  morStaked: (amount: string) => string;
  morNotStaked: string;
  morIdle: (amount: string) => string;
  morPending: (amount: string) => string;
  morNoPending: string;
  morSubnet: (amount: string) => string;
  morTiny: string;
  queueStuck: (txs: string) => string;
  queueRow: (nonce: string, action: string, sigs: string) => string;
  queueUnsigned: string;
  allocationUnsaved: string;
  idleCash: (value: string) => string;
  nothingStuck: string;
  headlineJobs: (value: string) => string;
  headlineStaked: (value: string, share: string) => string;
  headlineIdle: (value: string) => string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    sections: {
      cash: "The cash",
      incoming: "What comes in",
      outgoing: "What goes out",
      payments: "Payments",
      vault: "Support vault",
      mor: "MOR (subnet stake)",
      attention: "Needs attention",
    },
    person: { one: "person", many: "people" },
    tx: { one: "stuck transaction", many: "stuck transactions" },
    ownCash: (name, value) => `${name} has ${value} in its own cash.`,
    ownCashOnly: (name, value) => `${name} has ${value} in its own cash`,
    brandsToo: (value) =>
      `. Adding the treasuries of the brands it tracks, the page shows ${value} — but that money lives in separate multisigs and can't be spent from here.`,
    nothingEarning: (value) => `Nothing is earning: the ${value} is sitting idle, losing to inflation.`,
    staked: (value, share, rate) => `Of that total, ${value} (${share}) is in the Morpho vault earning${rate}.`,
    atRate: (apy) => ` at ${apy} a year`,
    perMonthYield: (value) => `, which comes to about ${value} a month`,
    idleLeft: (value) =>
      `${value} is left sitting idle. Putting it in the vault doesn't lock the money — it can be withdrawn at any time.`,
    harvestable: (value) => `It has already earned ${value} of interest that hasn't been harvested for the team's payment yet.`,
    noIncoming: "Nothing came in on record over the last 6 months. All revenue today is history, not flow.",
    incomingTotal: (value) => `Over the last 6 months ${value} came in.`,
    jobsDominant: (share) =>
      `Practically all of it (${share}) came from agency jobs — that is, one-off work, not recurring revenue. If the jobs stop, the income stops with them.`,
    jobsMixed: (share) => `${share} came from agency jobs and the rest from the brands' on-chain revenue.`,
    jobsNone: "It all came from the brands' on-chain revenue — no agency jobs in the period.",
    pendingJobs: (value) => `There is ${value} in jobs marked as receivable, not yet paid.`,
    noCosts: (name) => `No fixed costs are booked under ${name}.`,
    costsLast: (name, value, duration) => `${name}'s fixed costs are ${value} a month. At the current cash that lasts ${duration}.`,
    overTenYears: "over 10 years",
    aboutMonths: (n) => `about ${n} months`,
    allPortalCosts: (total, diff) =>
      `Counting every portal's costs, it's ${total} a month. The ${diff} difference is booked against the brands — worth checking who is actually paying that, because it doesn't come out of this cash.`,
    noPool: "Stream payments haven't been set up yet — there is no pool.",
    poolIdle: (people) => `The pool exists with ${people}, but the tap is closed: nobody is being paid right now.`,
    streaming: (value, people) => `The stream is paying ${value} a month, split across ${people}.`,
    symbolicFlow:
      "Everyone connected to the pool already receives their share straight into their wallet, in real time — but at this rate it's cents per person. It's a flow test, not a salary; paying people for real means opening the tap, with more capital or revenue to sustain it.",
    yieldCovers: (value) => `The vault's yield (${value}/mo) covers the stream on its own — at this rate the principal isn't touched.`,
    yieldShort: (value) =>
      `The vault's yield is ${value}/mo and doesn't cover the stream: the difference comes out of the principal, which shrinks over time.`,
    connectedCount: (connected, total) =>
      `${connected} of ${total} have connected their wallet to the pool. Whoever hasn't still accrues their share, but only actually receives it after connecting.`,
    bufferRunway: (buffer, days) =>
      `The converted buffer is ${buffer} and, with nothing topped up, the payment keeps running for ${days} days.`,
    vaultEmpty:
      "The support vault is set up and ready, but nobody has deposited yet — the yield for the payroll only starts once money comes in.",
    vaultTotal: (value, people, apy, fee, monthly) =>
      `The support vault holds ${value} from ${people}. It lends to Moonwell${apy}, and ${fee} of the interest becomes SOPA revenue for the payroll${monthly}`,
    vaultMonthly: (value) => ` — about ${value} a month at the current pace.`,
    vaultEarned: (value) =>
      `It has earned ${value} for SOPA so far. Whoever deposited withdraws whenever they want — only the yield is shared.`,
    vaultTeamOnly:
      "So far only the team itself has deposited — it's still a test, not outside backing. To become meaningful revenue it needs a lot of capital parked there (tens of thousands generate tens of dollars a month).",
    morNone: "SOPA has no MOR staked or harvested yet — the pipeline's MOR share (10% at the top) hasn't run.",
    morStaked: (amount) =>
      `SOPA has ${amount} staked into the Gnars subnet (Morpheus, on Base) — reinvesting the cut it gets from the pipeline. The principal is still its own, withdrawable after the 7-day lock.`,
    morNotStaked:
      "SOPA has no MOR staked into the subnet at the moment — what it receives from the pipeline is sitting idle, not reinvested.",
    morIdle: (amount) => `It has already harvested ${amount}, but it's sitting in the wallet, neither earning nor staked.`,
    morPending: (amount) => `There is ${amount} of reward credited and waiting on a withdrawal (from the Splits warehouse).`,
    morNoPending: "No reward waiting on a withdrawal right now — the last cut has been harvested.",
    morSubnet: (amount) =>
      `The subnet has ${amount} accumulated to claim in the pipeline; of that total SOPA takes 10% (the rest becomes USDC for Gnars and SOPA further down).`,
    morTiny: "These are small amounts (a fraction of MOR) — seed/test of the flow, not meaningful revenue yet.",
    queueStuck: (txs) =>
      `There are ${txs} in the multisig queue. They execute in order, so the first stuck one holds up all the others.`,
    queueRow: (nonce, action, sigs) => `· #${nonce} — ${action} (${sigs} signatures)`,
    queueUnsigned: "None of them has a signature yet. Signing or rejecting unblocks the queue; leaving them there doesn't.",
    allocationUnsaved:
      "The budget slices (salaries / costs / free) were never saved — what the page shows is just a default suggestion, not a team decision.",
    idleCash: (value) => `${value} of the cash is still not earning.`,
    nothingStuck: "Nothing stuck: the multisig queue is clean and the budget decisions are on record.",
    headlineJobs: (value) =>
      `${value} in cash, almost all of it coming from agency jobs — the revenue still depends on one-off work.`,
    headlineStaked: (value, share) => `${value} in cash, ${share} earning.`,
    headlineIdle: (value) => `${value} in cash, nothing earning yet.`,
  },
  pt: {
    sections: {
      cash: "O caixa",
      incoming: "O que entra",
      outgoing: "O que sai",
      payments: "Pagamentos",
      vault: "Cofre de apoio",
      mor: "MOR (stake na subnet)",
      attention: "Precisa de atenção",
    },
    person: { one: "pessoa", many: "pessoas" },
    tx: { one: "transação parada", many: "transações paradas" },
    ownCash: (name, value) => `A ${name} tem ${value} no próprio caixa.`,
    ownCashOnly: (name, value) => `A ${name} tem ${value} no próprio caixa`,
    brandsToo: (value) =>
      `. Somando os tesouros das marcas que ela acompanha, a página mostra ${value} — mas esse dinheiro é de multisigs separados e não dá pra gastar daqui.`,
    nothingEarning: (value) => `Nada está rendendo: os ${value} estão parados, perdendo pra inflação.`,
    staked: (value, share, rate) => `Desse total, ${value} (${share}) está no cofre da Morpho rendendo${rate}.`,
    atRate: (apy) => ` a ${apy} ao ano`,
    perMonthYield: (value) => `, o que dá cerca de ${value} por mês`,
    idleLeft: (value) =>
      `Sobram ${value} parados sem render. Guardar no cofre não trava o dinheiro — dá pra sacar a qualquer momento.`,
    harvestable: (value) => `Já rendeu ${value} de juros que ainda não foram colhidos pro pagamento do time.`,
    noIncoming: "Nos últimos 6 meses não entrou nada registrado. Toda a receita hoje é histórico, não fluxo.",
    incomingTotal: (value) => `Nos últimos 6 meses entraram ${value}.`,
    jobsDominant: (share) =>
      `Praticamente tudo (${share}) veio de jobs de agência — ou seja, de trabalho pontual, não de receita recorrente. Se os jobs pararem, a entrada para junto.`,
    jobsMixed: (share) => `${share} veio de jobs de agência e o resto de receita on-chain das marcas.`,
    jobsNone: "Tudo veio de receita on-chain das marcas — nenhum job de agência no período.",
    pendingJobs: (value) => `Há ${value} em jobs marcados como a receber, ainda não pagos.`,
    noCosts: (name) => `Nenhum custo fixo está lançado no nome da ${name}.`,
    costsLast: (name, value, duration) => `Os custos fixos da ${name} são ${value} por mês. No caixa atual isso dura ${duration}.`,
    overTenYears: "mais de 10 anos",
    aboutMonths: (n) => `cerca de ${n} meses`,
    allPortalCosts: (total, diff) =>
      `Contando os custos de todos os portais, são ${total} por mês. A diferença de ${diff} está lançada nas marcas — vale conferir quem está pagando isso de fato, porque não sai deste caixa.`,
    noPool: "O pagamento em stream ainda não foi configurado — não existe pool.",
    poolIdle: (people) => `A pool existe com ${people}, mas a torneira está fechada: ninguém está recebendo agora.`,
    streaming: (value, people) => `O stream está pagando ${value} por mês, dividido entre ${people}.`,
    symbolicFlow:
      "Cada pessoa conectada à pool já recebe a sua parte direto na carteira, em tempo real — mas nesse ritmo dá centavos por pessoa. É um teste de vazão, não um salário; pra remunerar de verdade é preciso subir a torneira, com mais capital ou receita pra sustentar.",
    yieldCovers: (value) => `O rendimento do cofre (${value}/mês) cobre o stream sozinho — nesse ritmo o principal não é tocado.`,
    yieldShort: (value) =>
      `O rendimento do cofre é ${value}/mês e não cobre o stream: a diferença sai do principal, que encolhe com o tempo.`,
    connectedCount: (connected, total) =>
      `${connected} de ${total} conectaram a carteira à pool. Quem não conectou acumula a parte dele, mas só recebe de fato depois de conectar.`,
    bufferRunway: (buffer, days) =>
      `A reserva convertida é de ${buffer} e, sem repor nada, o pagamento continua por ${days} dias.`,
    vaultEmpty:
      "O cofre de apoio está pronto e configurado, mas ninguém depositou ainda — o rendimento pro payroll só começa quando entrar dinheiro.",
    vaultTotal: (value, people, apy, fee, monthly) =>
      `O cofre de apoio tem ${value} de ${people}. Ele empresta pra Moonwell${apy}, e ${fee} do juro vira receita da SOPA pro payroll${monthly}`,
    vaultMonthly: (value) => ` — cerca de ${value} por mês no ritmo atual.`,
    vaultEarned: (value) =>
      `Já rendeu ${value} pra SOPA até agora. Quem depositou saca quando quiser — só o rendimento é compartilhado.`,
    vaultTeamOnly:
      "Por enquanto só o próprio time depositou — ainda é um teste, não apoio de fora. Pra virar receita relevante, precisa de bastante capital parado ali (dezenas de milhares geram dezenas de dólares por mês).",
    morNone: "A SOPA ainda não tem MOR staqueado nem colhido — a fatia de MOR do pipeline (10% no topo) ainda não rodou.",
    morStaked: (amount) =>
      `A SOPA tem ${amount} staqueados na subnet da Gnars (Morpheus, na Base) — reinvestindo de volta o corte que recebe do pipeline. O principal continua dela, sacável depois do lock de 7 dias.`,
    morNotStaked:
      "A SOPA não tem MOR staqueado na subnet no momento — o que recebe do pipeline está parado, não reinvestido.",
    morIdle: (amount) => `Já colheu ${amount}, mas estão parados na carteira, sem render nem staquear.`,
    morPending: (amount) => `Tem ${amount} de reward creditados esperando saque (withdraw do warehouse dos Splits).`,
    morNoPending: "Nada de reward esperando saque agora — o último corte já foi colhido.",
    morSubnet: (amount) =>
      `A subnet tem ${amount} acumulados pra reivindicar no pipeline; desse total a SOPA leva 10% (o resto vira USDC pra Gnars e SOPA lá embaixo).`,
    morTiny: "São quantias pequenas (fração de MOR) — semente/teste do fluxo, ainda não receita relevante.",
    queueStuck: (txs) =>
      `Tem ${txs} na fila do multisig. Elas executam em ordem, então a primeira travada segura todas as outras.`,
    queueRow: (nonce, action, sigs) => `· #${nonce} — ${action} (${sigs} assinaturas)`,
    queueUnsigned: "Nenhuma delas tem assinatura ainda. Assinar ou rejeitar destrava a fila; deixar parado não.",
    allocationUnsaved:
      "As fatias do orçamento (salários / custos / livre) nunca foram salvas — o que a página mostra é só uma sugestão padrão, não uma decisão do time.",
    idleCash: (value) => `${value} do caixa continuam sem render.`,
    nothingStuck: "Nada travado: fila do multisig limpa e as decisões de orçamento estão registradas.",
    headlineJobs: (value) =>
      `${value} em caixa, quase tudo vindo de jobs de agência — a receita ainda depende de trabalho pontual.`,
    headlineStaked: (value, share) => `${value} em caixa, ${share} rendendo.`,
    headlineIdle: (value) => `${value} em caixa, nada rendendo ainda.`,
  },
};

export function buildTreasuryBriefing(i: BriefingInput, locale: Locale = DEFAULT_LOCALE): Briefing {
  const c = COPY[locale];
  const people = (n: number) => plural(n, c.person.one, c.person.many);
  const sections: BriefingSection[] = [];

  // ---- 1. The cash ----
  const idleUsd = Math.max(0, i.ownTreasuryUsd - (i.stakedUsd ?? 0));
  const stakedPct = i.ownTreasuryUsd > 0 ? (i.stakedUsd ?? 0) / i.ownTreasuryUsd : 0;
  const cash: string[] = [];

  cash.push(
    i.brandCount > 0
      ? c.ownCashOnly(i.projectName, usd(i.ownTreasuryUsd)) + c.brandsToo(usd(i.combinedTreasuryUsd))
      : c.ownCash(i.projectName, usd(i.ownTreasuryUsd)),
  );

  if (i.stakedUsd != null) {
    if (i.stakedUsd <= 0) {
      cash.push(c.nothingEarning(usd(i.ownTreasuryUsd)));
    } else {
      const rate =
        i.apy != null
          ? c.atRate(pct(i.apy)) + (i.monthlyYieldUsd != null ? c.perMonthYield(usd(i.monthlyYieldUsd)) : "")
          : "";
      cash.push(c.staked(usd(i.stakedUsd), pct(stakedPct), rate));
      if (stakedPct < 0.8 && idleUsd > 1) cash.push(c.idleLeft(usd(idleUsd)));
    }
    if (i.harvestableUsd != null && i.harvestableUsd > 0.01) cash.push(c.harvestable(usd(i.harvestableUsd)));
  }
  sections.push({ title: c.sections.cash, paragraphs: cash });

  // ---- 2. What comes in ----
  const incoming: string[] = [];
  if (i.incomingLast6Usd <= 0) {
    incoming.push(c.noIncoming);
  } else {
    const jobShare = i.jobsLast6Usd / i.incomingLast6Usd;
    incoming.push(c.incomingTotal(usd(i.incomingLast6Usd)));
    if (jobShare > 0.8) incoming.push(c.jobsDominant(pct(jobShare)));
    else if (jobShare > 0) incoming.push(c.jobsMixed(pct(jobShare)));
    else incoming.push(c.jobsNone);
  }
  if (i.pendingJobsUsd > 0) incoming.push(c.pendingJobs(usd(i.pendingJobsUsd)));
  sections.push({ title: c.sections.incoming, paragraphs: incoming });

  // ---- 3. What goes out ----
  const outgoing: string[] = [];
  if (i.ownMonthlyCostsUsd <= 0) {
    outgoing.push(c.noCosts(i.projectName));
  } else {
    const months = i.ownTreasuryUsd / i.ownMonthlyCostsUsd;
    outgoing.push(
      c.costsLast(
        i.projectName,
        usd(i.ownMonthlyCostsUsd),
        months > 120 ? c.overTenYears : c.aboutMonths(mark(String(Math.round(months)))),
      ),
    );
  }
  if (i.allMonthlyCostsUsd > i.ownMonthlyCostsUsd) {
    outgoing.push(c.allPortalCosts(usd(i.allMonthlyCostsUsd), usd(i.allMonthlyCostsUsd - i.ownMonthlyCostsUsd)));
  }
  sections.push({ title: c.sections.outgoing, paragraphs: outgoing });

  // ---- 4. Payments ----
  const pay: string[] = [];
  if (i.streamMonthlyUsd == null) {
    pay.push(c.noPool);
  } else if (i.streamMonthlyUsd <= 0) {
    pay.push(c.poolIdle(people(i.memberCount)));
  } else {
    pay.push(c.streaming(usd(i.streamMonthlyUsd), people(i.memberCount)));
    if (i.streamMonthlyUsd < 5) pay.push(c.symbolicFlow);
    if (i.monthlyYieldUsd != null && i.monthlyYieldUsd > 0) {
      pay.push(
        i.monthlyYieldUsd >= i.streamMonthlyUsd
          ? c.yieldCovers(usd(i.monthlyYieldUsd))
          : c.yieldShort(usd(i.monthlyYieldUsd)),
      );
    }
  }
  if (i.memberCount > 0 && i.connectedCount < i.memberCount) {
    pay.push(c.connectedCount(mark(String(i.connectedCount)), mark(String(i.memberCount))));
  }
  if (i.streamRunwayDays != null && i.streamMonthlyUsd != null && i.streamMonthlyUsd > 0) {
    pay.push(c.bufferRunway(usd(i.streamBufferUsd), mark(String(Math.floor(i.streamRunwayDays)))));
  }
  sections.push({ title: c.sections.payments, paragraphs: pay });

  // ---- 4b. Community support vault ----
  if (i.vault) {
    const v = i.vault;
    const vault: string[] = [];
    if (v.depositedUsd <= 0 || v.backers === 0) {
      vault.push(c.vaultEmpty);
    } else {
      const monthlyToSopa = v.apy != null ? ((v.depositedUsd * v.apy) / 12) * v.feeToSopa : null;
      vault.push(
        c.vaultTotal(
          usd(v.depositedUsd),
          people(v.backers),
          v.apy != null ? c.atRate(pct(v.apy)) : "",
          pct(v.feeToSopa),
          monthlyToSopa != null ? c.vaultMonthly(usd(monthlyToSopa)) : ".",
        ),
      );
      vault.push(c.vaultEarned(usd(v.sopaEarnedUsd)));
      // Honest scale check: is this real community backing or the team testing?
      if (v.teamBackers >= v.backers) vault.push(c.vaultTeamOnly);
    }
    sections.push({ title: c.sections.vault, paragraphs: vault });
  }

  // ---- 4c. MOR (subnet stake + pipeline rewards) ----
  if (i.mor) {
    const m = i.mor;
    const hasAny = m.stakedMor > 0 || m.walletMor > 0 || m.pendingMor > 0;
    const line: string[] = [];
    if (!hasAny) {
      line.push(c.morNone);
    } else {
      line.push(m.stakedMor > 0 ? c.morStaked(mor(m.stakedMor)) : c.morNotStaked);
      // Harvested (in the wallet) vs still to harvest (in the warehouse).
      if (m.walletMor > 0) line.push(c.morIdle(mor(m.walletMor)));
      line.push(m.pendingMor > 0 ? c.morPending(mor(m.pendingMor)) : c.morNoPending);
      if (m.subnetPendingMor > 0.001) line.push(c.morSubnet(mor(m.subnetPendingMor)));
      // Honest scale check — these are fractions of MOR, not real income yet.
      if (m.stakedMor + m.walletMor + m.pendingMor < 100) line.push(c.morTiny);
    }
    sections.push({ title: c.sections.mor, paragraphs: line });
  }

  // ---- 5. Needs attention ----
  const attention: string[] = [];
  if (i.queued.length > 0) {
    const unsigned = i.queued.filter((q) => q.confirmations === 0);
    attention.push(c.queueStuck(plural(i.queued.length, c.tx.one, c.tx.many)));
    for (const q of i.queued.slice(0, 5)) {
      attention.push(c.queueRow(mark(String(q.nonce)), q.action, mark(`${q.confirmations}/${q.required}`)));
    }
    if (unsigned.length === i.queued.length) attention.push(c.queueUnsigned);
  }
  if (!i.allocationSaved) attention.push(c.allocationUnsaved);
  if (i.stakedUsd != null && i.ownTreasuryUsd > 0 && stakedPct < 0.5 && idleUsd > 50) {
    attention.push(c.idleCash(usd(idleUsd)));
  }
  if (attention.length === 0) attention.push(c.nothingStuck);
  sections.push({ title: c.sections.attention, paragraphs: attention });

  // ---- headline ----
  const headline =
    i.incomingLast6Usd > 0 && i.jobsLast6Usd / i.incomingLast6Usd > 0.8
      ? c.headlineJobs(usd(i.ownTreasuryUsd))
      : i.stakedUsd != null && i.stakedUsd > 0
        ? c.headlineStaked(usd(i.ownTreasuryUsd), pct(stakedPct))
        : c.headlineIdle(usd(i.ownTreasuryUsd));

  return {
    headline,
    sections,
    generatedAt: new Date().toISOString(),
  };
}
