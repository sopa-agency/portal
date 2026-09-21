import "server-only";

// Cliente mínimo da TypeSafe (modelo Jev): um POST com o estado e perguntas
// tipadas, e de volta vêm probabilidades — não texto. Por fetch, sem SDK: é um
// endpoint só. Contrato: https://docs.typesafe.ai/api.md
//
// Sem TYPESAFE_API_KEY a função devolve null e quem chama segue sem checagem:
// a chave é opcional, a funcionalidade também.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;

type Text = string | Readonly<Record<string, unknown>> | readonly unknown[];
export type NoulQuestion = { type: "noul"; instructions: Text; criteria?: { true?: Text; false?: Text } };
export type ScoreQuestion = { type: "score"; instructions: Text; criteria: readonly Text[] };
export type ChoiceQuestion = { type: "choice"; instructions: Text; criteria: Readonly<Record<string, Text | null>> };
export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ScoreAnswer = { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };
export type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type AnswerOf<Q> = Q extends { type: "noul" } ? NoulAnswer : Q extends { type: "score" } ? ScoreAnswer : Q extends { type: "choice" } ? ChoiceAnswer : never;

export type SystemOneResult<Qs extends Readonly<Record<string, Question>>> = { model: string; answers: { [K in keyof Qs]: AnswerOf<Qs[K]> }; usage: { input_tokens: number; output_tokens: number } };

export const typesafeKey = () => (process.env.TYPESAFE_API_KEY ?? "").trim() || null;

/** Nulo = sem chave configurada, ou a API não respondeu: nunca derruba quem chama. */
export async function systemOne<const Qs extends Readonly<Record<string, Question>>>(state: unknown, questions: Qs): Promise<SystemOneResult<Qs> | null> {
  const key = typesafeKey();
  if (!key) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state, questions }) });
      if (res.ok) return (await res.json()) as SystemOneResult<Qs>;
      // 429 e 529 pedem espera; o resto (401, 422) não melhora tentando de novo.
      if (res.status !== 429 && res.status !== 529) return null;
    } catch {
      /* rede ou timeout: uma segunda tentativa, depois desiste */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}
