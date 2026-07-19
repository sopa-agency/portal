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
};

export type BriefingSection = { title: string; paragraphs: string[] };
export type Briefing = { headline: string; sections: BriefingSection[]; generatedAt: string };

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : 0 });

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** "3 pessoas" / "1 pessoa" */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
        (meses > 120 ? "mais de 10 anos" : `cerca de ${Math.round(meses)} meses`) +
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
        "Isso é um valor de teste, não um salário. O encanamento todo funciona — pool, pesos, distribuição — mas na prática ninguém está sendo remunerado por ele ainda.",
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
      `${i.connectedCount} de ${i.memberCount} conectaram a carteira à pool. Quem não conectou acumula a parte dele, mas só recebe de fato depois de conectar.`,
    );
  }
  if (i.streamRunwayDays != null && i.streamMonthlyUsd != null && i.streamMonthlyUsd > 0) {
    pag.push(
      `A reserva convertida é de ${usd(i.streamBufferUsd)} e, sem repor nada, o pagamento continua por ${Math.floor(i.streamRunwayDays)} dias.`,
    );
  }
  sections.push({ title: "Pagamentos", paragraphs: pag });

  // ---- 5. Precisa de atenção ----
  const atencao: string[] = [];
  if (i.queued.length > 0) {
    const unsigned = i.queued.filter((q) => q.confirmations === 0);
    atencao.push(
      `Tem ${plural(i.queued.length, "transação parada", "transações paradas")} na fila do multisig. ` +
        `Elas executam em ordem, então a primeira travada segura todas as outras.`,
    );
    for (const q of i.queued.slice(0, 5)) {
      atencao.push(`· #${q.nonce} — ${q.action} (${q.confirmations}/${q.required} assinaturas)`);
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
