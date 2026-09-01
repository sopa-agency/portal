"use client";

// O formulário de /app-idea.
//
// A aposta central: um pedido de software bom não é um formulário bem
// preenchido, é um bom prompt. Então a tela é escrita pra puxar prosa — o campo
// grande vem PRIMEIRO e os rótulos falam como gente ("me explica no zap"), e as
// perguntas fechadas vêm depois, como o resumo que economiza a primeira
// resposta. A ordem inversa (perguntinhas antes) treina a pessoa a responder
// curto, e aí a prosa vem curta também.
//
// Copy toda em pt-BR e escrita à mão, não pelo dicionário i18n: esta página é
// pra clientes brasileiros, não pra equipe, e o dicionário é en-primeiro. Ela
// também não pode depender do LocaleProvider — roda sem sessão e sem cookie.

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { LIMITS, MIN_PITCH, QUESTIONS, type Question } from "@/lib/app-idea-options";

type Answers = Partial<Record<Question["id"], string>>;

const PITCH_PLACEHOLDER = `Ex.: Tenho uma escola de skate com 60 alunos. Hoje controlo as
mensalidades numa planilha e fico correndo atrás de quem não pagou
no WhatsApp, um por um, todo mês.

Queria uma tela onde eu vejo quem tá em dia e quem não tá, e que
mandasse o lembrete sozinha no dia 5. Os alunos não precisam entrar
em lugar nenhum — só eu e mais dois professores.

O chato de verdade é a cobrança manual. O resto eu levo na planilha
numa boa.`;

/** Uma pergunta fechada: pastilhas em vez de <select>, porque as opções todas
 *  visíveis é o que faz a pessoa perceber que "não sei" é permitido. */
function ChoiceGroup({
  question,
  value,
  onPick,
  invalid,
}: {
  question: Question;
  value: string | undefined;
  onPick: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-foreground">{question.title}</legend>
      {question.note && <p className="mt-0.5 text-xs text-foreground-subtle">{question.note}</p>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {question.choices.map((c) => {
          const on = value === c.value;
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(c.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                on
                  ? "border-accent-border bg-accent-bg text-accent"
                  : `bg-surface-elevated text-foreground-muted hover:border-border-strong hover:text-foreground ${
                      invalid ? "border-danger/50" : "border-border"
                    }`
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Counter({ used, max }: { used: number; max: number }) {
  // Só aparece perto do teto: um contador sempre visível vira meta, e a pessoa
  // escreve pro número em vez de escrever o pedido.
  if (used < max * 0.8) return null;
  return (
    <span className={`text-[11px] tabular-nums ${used >= max ? "text-danger" : "text-foreground-faint"}`}>
      {used}/{max}
    </span>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none";

export function AppIdeaForm() {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [pitch, setPitch] = useState("");
  const [successCriteria, setSuccess] = useState("");
  const [references, setReferences] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  // Honeypot. Escondido do olho E do leitor de tela (aria-hidden + tabIndex),
  // pra não virar um campo fantasma pra quem navega por teclado.
  const [website, setWebsite] = useState("");

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Só depois da primeira tentativa a tela pinta o que falta. Formulário que
  // acusa erro antes de você digitar trata a pessoa como suspeita.
  const [tried, setTried] = useState(false);

  const missing = useMemo(() => {
    const m = new Set<string>();
    if (!name.trim()) m.add("name");
    if (!contact.trim()) m.add("contact");
    if (pitch.trim().length < MIN_PITCH) m.add("pitch");
    if (!successCriteria.trim()) m.add("successCriteria");
    for (const q of QUESTIONS) if (!answers[q.id]) m.add(q.id);
    return m;
  }, [name, contact, pitch, successCriteria, answers]);

  async function submit() {
    setTried(true);
    if (missing.size > 0) {
      setError("Falta pouco — os campos marcados ainda estão vazios.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/app-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contact, pitch, successCriteria, references, website, ...answers }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      // Resposta ilegível não é sucesso nem fracasso silencioso: é falha
      // declarada. O pior desfecho aqui seria a pessoa achar que mandou.
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Não consegui enviar. Tente de novo em instantes.");
        return;
      }
      setSent(true);
    } catch {
      setError("Não consegui falar com o servidor. Confira sua conexão e tente de novo.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-5 py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-accent" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Chegou aqui.</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground-muted">
          Vou ler com calma e te responder no contato que você deixou. Se eu tiver dúvida, pergunto — dúvida minha
          agora é retrabalho seu depois.
        </p>
        <p className="mt-6 text-xs text-foreground-faint">Pode fechar esta página.</p>
      </main>
    );
  }

  const bad = (id: string) => tried && missing.has(id);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Pedido de app</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Me conta o app que você queria que existisse.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
          Não é um formulário de proposta. É pra você pensar em voz alta. Escreve como você me explicaria pessoalmente
          — o que te incomoda hoje, o que você faz na mão, o que seria bom parar de fazer. Leva uns cinco minutos, e
          quanto mais concreto, mais rápido eu consigo te dizer se dá e quanto custa.
        </p>
      </header>

      <div className="mt-10 space-y-8">
        {/* A prosa primeiro, de propósito. */}
        <section>
          <label htmlFor="pitch" className="block text-sm font-medium text-foreground">
            Escreve como se estivesse me explicando no WhatsApp
          </label>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            Imagina que eu sou muito bom de construir e não sei nada do seu mundo. Me dá o contexto: quem usa, o que
            acontece hoje, onde dói.
          </p>
          <textarea
            id="pitch"
            value={pitch}
            onChange={(e) => setPitch(e.target.value.slice(0, LIMITS.pitch))}
            rows={12}
            placeholder={PITCH_PLACEHOLDER}
            className={`mt-2.5 ${inputClass} resize-y leading-relaxed ${bad("pitch") ? "border-danger/60" : ""}`}
          />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-foreground-faint">
              {pitch.trim().length < MIN_PITCH
                ? "Umas linhas a mais ajudam muito — pelo menos uma situação real."
                : "Isso já dá pra trabalhar."}
            </span>
            <Counter used={pitch.length} max={LIMITS.pitch} />
          </div>
        </section>

        {/* As fechadas, como resumo do que a prosa não obrigou a dizer. */}
        <section className="space-y-6 rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-foreground-muted">
            Agora o resumo rápido. É o que eu perguntaria de volta se você só tivesse mandado o texto acima.
          </p>
          {QUESTIONS.map((q) => (
            <ChoiceGroup
              key={q.id}
              question={q}
              value={answers[q.id]}
              invalid={bad(q.id)}
              onPick={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
            />
          ))}
        </section>

        {/* A pergunta que separa pedido bom de pedido vago. */}
        <section>
          <label htmlFor="success" className="block text-sm font-medium text-foreground">
            Como você vai saber que funcionou?
          </label>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            Uma frase. Ex.: “eu não preciso mais abrir a planilha na segunda de manhã”.
          </p>
          <textarea
            id="success"
            value={successCriteria}
            onChange={(e) => setSuccess(e.target.value.slice(0, LIMITS.successCriteria))}
            rows={2}
            placeholder="Vou saber que funcionou quando…"
            className={`mt-2.5 ${inputClass} resize-y ${bad("successCriteria") ? "border-danger/60" : ""}`}
          />
          <div className="mt-1.5 flex justify-end">
            <Counter used={successCriteria.length} max={LIMITS.successCriteria} />
          </div>
        </section>

        <section>
          <label htmlFor="refs" className="block text-sm font-medium text-foreground">
            Tem algum app que já faz parecido? <span className="text-foreground-faint">(opcional)</span>
          </label>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            Links, prints, nome do concorrente. Um exemplo vale meia hora de conversa.
          </p>
          <textarea
            id="refs"
            value={references}
            onChange={(e) => setReferences(e.target.value.slice(0, LIMITS.references))}
            rows={2}
            placeholder="https://…"
            className={`mt-2.5 ${inputClass} resize-y`}
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-foreground">
              Como te chamo?
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, LIMITS.name))}
              placeholder="seu nome"
              className={`mt-2 ${inputClass} ${bad("name") ? "border-danger/60" : ""}`}
            />
          </div>
          <div>
            <label htmlFor="contact" className="block text-sm font-medium text-foreground">
              Onde te acho?
            </label>
            <input
              id="contact"
              value={contact}
              onChange={(e) => setContact(e.target.value.slice(0, LIMITS.contact))}
              placeholder="e-mail ou @telegram"
              className={`mt-2 ${inputClass} ${bad("contact") ? "border-danger/60" : ""}`}
            />
          </div>
        </section>

        {/* Honeypot. Fora do fluxo visual e fora do fluxo do teclado. */}
        <div aria-hidden className="pointer-events-none absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Não preencha este campo</label>
          <input
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <button
            type="button"
            onClick={submit}
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-xl border border-accent-border bg-accent-bg px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {sending ? "Enviando…" : "Mandar pro Vlad"}
          </button>
          <span className="text-xs text-foreground-faint">
            Sem cadastro, sem compromisso. Só eu leio.
          </span>
        </div>
      </div>
    </main>
  );
}
