// The treasury page in prose. Every number here is the same live value the
// cards above render — this just says out loud what they add up to, so someone
// can read the state in thirty seconds instead of decoding six panels.
//
// Rule for anything written here: no cheerleading. If money is idle, if the
// stream is symbolic, if a queue is stuck, the text says so.

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

/** "3 pessoas" / "1 pessoa" */
const plural = (n: number, one: string, many: string) => `${mark(String(n))} ${n === 1 ? one : many}`;

export function buildTreasuryBriefing(i: BriefingInput): Briefing {
  const sections: BriefingSection[] = [];

  // ---- 1. O caixa ----
  const idleUsd = Math.max(0, i.ownTreasuryUsd - (i.stakedUsd ?? 0));
  const stakedPct = i.ownTreasuryUsd > 0 ? (i.stakedUsd ?? 0) / i.ownTreasuryUsd : 0;
  const caixa: string[] = [];

  caixa.push(
    `A ${i.projectName} tem ${usd(i.ownTreasuryUsd)} no próprio caixa` +
      (i.brandCount > 0
        ? `. Somando os tesouros das marcas que ela acompanha, a página mostra ${usd(i.combinedTreasuryUsd)} — mas esse dinheiro é de multisigs separados e não dá pra gastar daqui.`
        : "."),
  );

  if (i.stakedUsd != null) {
    if (i.stakedUsd <= 0) {
      caixa.push(`Nada está rendendo: os ${usd(i.ownTreasuryUsd)} estão parados, perdendo pra inflação.`);
    } else {
      const rende =
        i.apy != null
          ? ` a ${pct(i.apy)} ao ano${i.monthlyYieldUsd != null ? `, o que dá cerca de ${usd(i.monthlyYieldUsd)} por mês` : ""}`
          : "";
      caixa.push(`Desse total, ${usd(i.stakedUsd)} (${pct(stakedPct)}) está no cofre da Morpho rendendo${rende}.`);
      if (stakedPct < 0.8 && idleUsd > 1) {
        caixa.push(
          `Sobram ${usd(idleUsd)} parados sem render. Guardar no cofre não trava o dinheiro — dá pra sacar a qualquer momento.`,
        );
      }
    }
    if (i.harvestableUsd != null && i.harvestableUsd > 0.01) {
      caixa.push(`Já rendeu ${usd(i.harvestableUsd)} de juros que ainda não foram colhidos pro pagamento do time.`);
    }
  }
  sections.push({ title: "O caixa", paragraphs: caixa });

  // ---- 2. O que entra ----
  const entra: string[] = [];
  if (i.incomingLast6Usd <= 0) {
    entra.push("Nos últimos 6 meses não entrou nada registrado. Toda a receita hoje é histórico, não fluxo.");
  } else {
    const jobShare = i.jobsLast6Usd / i.incomingLast6Usd;
    entra.push(`Nos últimos 6 meses entraram ${usd(i.incomingLast6Usd)}.`);
    if (jobShare > 0.8) {
      entra.push(
        `Praticamente tudo (${pct(jobShare)}) veio de jobs de agência — ou seja, de trabalho pontual, não de receita recorrente. Se os jobs pararem, a entrada para junto.`,
      );
    } else if (jobShare > 0) {
      entra.push(`${pct(jobShare)} veio de jobs de agência e o resto de receita on-chain das marcas.`);
    } else {
      entra.push("Tudo veio de receita on-chain das marcas — nenhum job de agência no período.");
    }
  }
  if (i.pendingJobsUsd > 0) entra.push(`Há ${usd(i.pendingJobsUsd)} em jobs marcados como a receber, ainda não pagos.`);
  sections.push({ title: "O que entra", paragraphs: entra });

  // ---- 3. O que sai ----
  const sai: string[] = [];
  if (i.ownMonthlyCostsUsd <= 0) {
    sai.push(`Nenhum custo fixo está lançado no nome da ${i.projectName}.`);
  } else {
    const meses = i.ownTreasuryUsd / i.ownMonthlyCostsUsd;
    sai.push(
      `Os custos fixos da ${i.projectName} são ${usd(i.ownMonthlyCostsUsd)} por mês. No caixa atual isso dura ` +
        (meses > 120 ? "mais de 10 anos" : `cerca de ${mark(String(Math.round(meses)))} meses`) +
        ".",
    );
  }
  if (i.allMonthlyCostsUsd > i.ownMonthlyCostsUsd) {
    sai.push(
      `Contando os custos de todos os portais, são ${usd(i.allMonthlyCostsUsd)} por mês. A diferença de ` +
        `${usd(i.allMonthlyCostsUsd - i.ownMonthlyCostsUsd)} está lançada nas marcas — vale conferir quem está pagando isso de fato, ` +
        `porque não sai deste caixa.`,
    );
  }
  sections.push({ title: "O que sai", paragraphs: sai });

  // ---- 4. Pagamentos ----
  const pag: string[] = [];
  if (i.streamMonthlyUsd == null) {
    pag.push("O pagamento em stream ainda não foi configurado — não existe pool.");
  } else if (i.streamMonthlyUsd <= 0) {
    pag.push(
      `A pool existe com ${plural(i.memberCount, "pessoa", "pessoas")}, mas a torneira está fechada: ninguém está recebendo agora.`,
    );
  } else {
    pag.push(
      `O stream está pagando ${usd(i.streamMonthlyUsd)} por mês, dividido entre ${plural(i.memberCount, "pessoa", "pessoas")}.`,
    );
    if (i.streamMonthlyUsd < 5) {
      pag.push(
        "Cada pessoa conectada à pool já recebe a sua parte direto na carteira, em tempo real — mas nesse ritmo dá centavos por pessoa. É um teste de vazão, não um salário; pra remunerar de verdade é preciso subir a torneira, com mais capital ou receita pra sustentar.",
      );
    }
    if (i.monthlyYieldUsd != null && i.monthlyYieldUsd > 0) {
      pag.push(
        i.monthlyYieldUsd >= i.streamMonthlyUsd
          ? `O rendimento do cofre (${usd(i.monthlyYieldUsd)}/mês) cobre o stream sozinho — nesse ritmo o principal não é tocado.`
          : `O rendimento do cofre é ${usd(i.monthlyYieldUsd)}/mês e não cobre o stream: a diferença sai do principal, que encolhe com o tempo.`,
      );
    }
  }
  if (i.memberCount > 0 && i.connectedCount < i.memberCount) {
    pag.push(
      `${mark(String(i.connectedCount))} de ${mark(String(i.memberCount))} conectaram a carteira à pool. Quem não conectou acumula a parte dele, mas só recebe de fato depois de conectar.`,
    );
  }
  if (i.streamRunwayDays != null && i.streamMonthlyUsd != null && i.streamMonthlyUsd > 0) {
    pag.push(
      `A reserva convertida é de ${usd(i.streamBufferUsd)} e, sem repor nada, o pagamento continua por ${mark(String(Math.floor(i.streamRunwayDays)))} dias.`,
    );
  }
  sections.push({ title: "Pagamentos", paragraphs: pag });

  // ---- 4b. Cofre de apoio (community vault) ----
  if (i.vault) {
    const v = i.vault;
    const cofre: string[] = [];
    if (v.depositedUsd <= 0 || v.backers === 0) {
      cofre.push(
        "O cofre de apoio está pronto e configurado, mas ninguém depositou ainda — o rendimento pro payroll só começa quando entrar dinheiro.",
      );
    } else {
      const monthlyToSopa = v.apy != null ? (v.depositedUsd * v.apy) / 12 * v.feeToSopa : null;
      cofre.push(
        `O cofre de apoio tem ${usd(v.depositedUsd)} de ${plural(v.backers, "pessoa", "pessoas")}. ` +
          `Ele empresta pra Moonwell${v.apy != null ? ` a ${pct(v.apy)} ao ano` : ""}, e ${pct(v.feeToSopa)} do juro vira receita da SOPA pro payroll` +
          (monthlyToSopa != null ? ` — cerca de ${usd(monthlyToSopa)} por mês no ritmo atual.` : "."),
      );
      cofre.push(`Já rendeu ${usd(v.sopaEarnedUsd)} pra SOPA até agora. Quem depositou saca quando quiser — só o rendimento é compartilhado.`);
      // Honest scale check: is this real community backing or the team testing?
      if (v.teamBackers >= v.backers) {
        cofre.push(
          "Por enquanto só o próprio time depositou — ainda é um teste, não apoio de fora. Pra virar receita relevante, precisa de bastante capital parado ali (dezenas de milhares geram dezenas de dólares por mês).",
        );
      }
    }
    sections.push({ title: "Cofre de apoio", paragraphs: cofre });
  }

  // ---- 4c. MOR (stake na subnet + rewards do pipeline) ----
  if (i.mor) {
    const m = i.mor;
    const hasAny = m.stakedMor > 0 || m.walletMor > 0 || m.pendingMor > 0;
    const linha: string[] = [];
    if (!hasAny) {
      linha.push("A SOPA ainda não tem MOR staqueado nem colhido — a fatia de MOR do pipeline (10% no topo) ainda não rodou.");
    } else {
      if (m.stakedMor > 0) {
        linha.push(
          `A SOPA tem ${mor(m.stakedMor)} staqueados na subnet da Gnars (Morpheus, na Base) — reinvestindo de volta o corte que recebe do pipeline. ` +
            `O principal continua dela, sacável depois do lock de 7 dias.`,
        );
      } else {
        linha.push("A SOPA não tem MOR staqueado na subnet no momento — o que recebe do pipeline está parado, não reinvestido.");
      }
      // Rewards colhidos (na carteira) vs por colher (no warehouse).
      if (m.walletMor > 0) {
        linha.push(`Já colheu ${mor(m.walletMor)}, mas estão parados na carteira, sem render nem staquear.`);
      }
      linha.push(
        m.pendingMor > 0
          ? `Tem ${mor(m.pendingMor)} de reward creditados esperando saque (withdraw do warehouse dos Splits).`
          : "Nada de reward esperando saque agora — o último corte já foi colhido.",
      );
      if (m.subnetPendingMor > 0.001) {
        linha.push(
          `A subnet tem ${mor(m.subnetPendingMor)} acumulados pra reivindicar no pipeline; desse total a SOPA leva 10% (o resto vira USDC pra Gnars e SOPA lá embaixo).`,
        );
      }
      // Honest scale check — these are fractions of MOR, not real income yet.
      if (m.stakedMor + m.walletMor + m.pendingMor < 100) {
        linha.push("São quantias pequenas (fração de MOR) — semente/teste do fluxo, ainda não receita relevante.");
      }
    }
    sections.push({ title: "MOR (stake na subnet)", paragraphs: linha });
  }

  // ---- 5. Precisa de atenção ----
  const atencao: string[] = [];
  if (i.queued.length > 0) {
    const unsigned = i.queued.filter((q) => q.confirmations === 0);
    atencao.push(
      `Tem ${plural(i.queued.length, "transação parada", "transações paradas")} na fila do multisig. ` +
        `Elas executam em ordem, então a primeira travada segura todas as outras.`,
    );
    for (const q of i.queued.slice(0, 5)) {
      atencao.push(`· #${mark(String(q.nonce))} — ${q.action} (${mark(`${q.confirmations}/${q.required}`)} assinaturas)`);
    }
    if (unsigned.length === i.queued.length) {
      atencao.push("Nenhuma delas tem assinatura ainda. Assinar ou rejeitar destrava a fila; deixar parado não.");
    }
  }
  if (!i.allocationSaved) {
    atencao.push(
      "As fatias do orçamento (salários / custos / livre) nunca foram salvas — o que a página mostra é só uma sugestão padrão, não uma decisão do time.",
    );
  }
  if (i.stakedUsd != null && i.ownTreasuryUsd > 0 && stakedPct < 0.5 && idleUsd > 50) {
    atencao.push(`${usd(idleUsd)} do caixa continuam sem render.`);
  }
  if (atencao.length === 0) atencao.push("Nada travado: fila do multisig limpa e as decisões de orçamento estão registradas.");
  sections.push({ title: "Precisa de atenção", paragraphs: atencao });

  // ---- headline ----
  const headline =
    i.incomingLast6Usd > 0 && i.jobsLast6Usd / i.incomingLast6Usd > 0.8
      ? `${usd(i.ownTreasuryUsd)} em caixa, quase tudo vindo de jobs de agência — a receita ainda depende de trabalho pontual.`
      : `${usd(i.ownTreasuryUsd)} em caixa` +
        (i.stakedUsd != null && i.stakedUsd > 0 ? `, ${pct(stakedPct)} rendendo.` : ", nada rendendo ainda.");

  return {
    headline,
    sections,
    generatedAt: new Date().toISOString(),
  };
}
