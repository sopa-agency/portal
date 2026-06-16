import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// SOPA — deck-style "About" presentation. Services agency (dev + marketing)
// with a hybrid model: paid service + participation by engagement level, across
// 3 tiers. Gated to the SOPA portal (project.about + slug). Content lives here
// because it's the only deck for now; a second project would key by slug.
// ---------------------------------------------------------------------------

type Tier = {
  n: string;
  name: string;
  total: string;
  referral: string;
  agency: string;
  involvement: string;
  capture: string;
};

// ¼ of the take goes to whoever brought the project in, ¾ to the agency — the
// split scales proportionally as involvement deepens (20 → 30 → 40%).
const TIERS: Tier[] = [
  {
    n: "01",
    name: "Pontual",
    total: "20%",
    referral: "5%",
    agency: "15%",
    involvement: "Um vertical fechado — dev OU marketing — em escopo definido.",
    capture: "Demanda direta ou indicação.",
  },
  {
    n: "02",
    name: "Operação",
    total: "30%",
    referral: "7,5%",
    agency: "22,5%",
    involvement: "Dev + marketing rodando de forma contínua, time dedicado.",
    capture: "Relacionamento, projeto recorrente.",
  },
  {
    n: "03",
    name: "Motor",
    total: "40%",
    referral: "10%",
    agency: "30%",
    involvement: "SOPA toca o projeto ponta a ponta, é o motor principal.",
    capture: "Co-construção / incubação.",
  },
];

const ROLES: { role: string; scope: string }[] = [
  { role: "Dev lead", scope: "Arquitetura, infra e entrega técnica entre portais." },
  { role: "Marketing lead", scope: "Estratégia, conteúdo e cadência de cada projeto." },
  { role: "Design / Criação", scope: "Identidade visual, peças e narrativa." },
  { role: "Comunidade / Social", scope: "Presença diária e relacionamento com a base." },
  { role: "Operações / Financeiro", scope: "Faturamento, contabilidade e contratos." },
  { role: "Business Development", scope: "Captação, indicações e novos projetos." },
];

const NEXT: string[] = [
  "Fechar os 3 tiers e o split (indicação ¼ · agência ¾).",
  "Constituir a LTDA e organizar a contabilidade.",
  "Atribuir os papéis — um dono por frente.",
  "Definir o processo de entrada e de upgrade de tier de um projeto.",
];

const TOTAL = 6;

function Slide({
  n,
  eyebrow,
  title,
  children,
}: {
  n: number;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex min-h-full snap-start snap-always flex-col justify-center px-6 py-12 md:px-16">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-xs font-semibold tabular-nums text-accent">
            {String(n).padStart(2, "0")} / {String(TOTAL).padStart(2, "0")}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground-subtle">
            {eyebrow}
          </span>
        </div>
        <h2 className="text-balance text-3xl font-bold leading-tight text-foreground md:text-5xl">
          {title}
        </h2>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export default async function AboutPage() {
  const project = await getActiveProject();
  if (!project.about || project.slug !== "sopa") notFound();

  return (
    <div className="h-[calc(100dvh-3rem)] snap-y snap-mandatory overflow-y-auto scroll-smooth rounded-2xl border border-border bg-surface md:h-[calc(100dvh-4rem)]">
      {/* 1 — Cover */}
      <section className="flex min-h-full snap-start snap-always flex-col justify-center px-6 py-12 md:px-16">
        <div className="mx-auto w-full max-w-5xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
            Decisões estruturais · {new Date().getFullYear()}
          </span>
          <h1 className="mt-4 text-6xl font-black tracking-tight text-foreground md:text-8xl">
            SOPA
          </h1>
          <p className="mt-5 max-w-2xl text-balance text-xl text-foreground-muted md:text-2xl">
            Agência de dev + marketing operando entre portais.
          </p>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-foreground-subtle md:text-lg">
            Toda <span className="text-accent">sopa</span> começa com ingredientes que, sozinhos, não
            viram refeição. A SOPA é a panela: projetos, pessoas e habilidades entram soltos e saem
            como algo que alimenta o time todo. Uma cozinha coletiva pra construir e crescer junto —
            quente, simples e feita pra dividir.
          </p>
          <p className="mt-10 inline-flex items-center gap-2 text-xs text-foreground-faint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            role para navegar
          </p>
        </div>
      </section>

      {/* 2 — O modelo */}
      <Slide n={2} eyebrow="O modelo" title="Serviço + participação + indicação.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { k: "Serviço", v: "Dev e marketing entregues como serviço — escopo, time e cadência claros." },
            { k: "Participação", v: "Uma fatia por nível de envolvimento, alinhada ao resultado do projeto." },
            { k: "Indicação", v: "Quem traz o projeto participa — ¼ de cada engajamento vai para a indicação." },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border border-border bg-surface-elevated p-5">
              <p className="text-sm font-semibold text-accent">{c.k}</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{c.v}</p>
            </div>
          ))}
        </div>
      </Slide>

      {/* 3 — Tiers */}
      <Slide
        n={3}
        eyebrow="Captação × envolvimento"
        title="Três tiers de engajamento."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.n}
              className="flex flex-col rounded-xl border border-border bg-surface-elevated p-6"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold uppercase tracking-wide text-foreground-subtle">
                  {t.name}
                </span>
                <span className="font-mono text-xs text-foreground-faint">{t.n}</span>
              </div>
              <p className="mt-3 text-5xl font-black tabular-nums text-accent">{t.total}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
                <span>
                  <span className="font-semibold text-foreground">{t.referral}</span> indicação
                </span>
                <span>
                  <span className="font-semibold text-foreground">{t.agency}</span> agência
                </span>
              </div>
              <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm leading-relaxed text-foreground-muted">
                <p>{t.involvement}</p>
                <p className="text-foreground-subtle">{t.capture}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-foreground-subtle">
          Split fixo na proporção <span className="text-foreground">¼ indicação · ¾ agência</span> —
          escala junto com o tier conforme o envolvimento aumenta.
        </p>
      </Slide>

      {/* 4 — Estrutura operacional */}
      <Slide n={4} eyebrow="Estrutura" title="Operação organizada, contas separadas.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { k: "LTDA", v: "Empresa para operação e faturamento — contratos e notas previsíveis." },
            { k: "Contabilidade", v: "Caixa da agência contabilizado e organizado mês a mês." },
            { k: "Separação", v: "O caixa da SOPA é distinto dos tesouros que ela opera para os projetos." },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border border-border bg-surface-elevated p-5">
              <p className="text-sm font-semibold text-accent">{c.k}</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{c.v}</p>
            </div>
          ))}
        </div>
      </Slide>

      {/* 5 — Time & papéis */}
      <Slide n={5} eyebrow="Time" title="Um dono por frente.">
        <div className="grid gap-3 md:grid-cols-2">
          {ROLES.map((r) => (
            <div
              key={r.role}
              className="flex items-start gap-4 rounded-xl border border-border bg-surface-elevated p-4"
            >
              <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
              <div>
                <p className="text-sm font-semibold text-foreground">{r.role}</p>
                <p className="text-sm text-foreground-muted">{r.scope}</p>
              </div>
            </div>
          ))}
        </div>
      </Slide>

      {/* 6 — Próximos passos */}
      <Slide n={6} eyebrow="Decisões a fechar" title="O que decidimos agora.">
        <ol className="space-y-3">
          {NEXT.map((step, i) => (
            <li
              key={step}
              className="flex items-start gap-4 rounded-xl border border-border bg-surface-elevated p-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg font-mono text-sm font-bold text-accent">
                {i + 1}
              </span>
              <span className="pt-0.5 text-sm leading-relaxed text-foreground">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-sm text-foreground-faint">SOPA — {new Date().getFullYear()}</p>
      </Slide>
    </div>
  );
}
