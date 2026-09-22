import "server-only";
import { experimental_evaluate as evaluate } from "ai";

// Julgamentos tipados com o Jev (TypeSafe): um estado e perguntas, e de volta vêm
// probabilidades — não texto. Contrato: https://docs.typesafe.ai/api.md
//
// Dois caminhos, na ordem:
// 1. Vercel AI Gateway (`AI_GATEWAY_API_KEY`, ou o token OIDC do deploy): sem
//    chave da TypeSafe no portal, gasto na fatura da Vercel, ZDR pelo gateway.
// 2. API direta da TypeSafe (`TYPESAFE_API_KEY`): a reserva, se o gateway falhar
//    ou não estiver configurado.
// Sem nenhum dos dois, a função devolve null e quem chama segue sem julgamento:
// a chave é opcional, a funcionalidade também.

const DIRECT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const GATEWAY_MODEL = "typesafe-ai/jev";
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

export type SystemOneResult<Qs extends Readonly<Record<string, Question>>> = { model: string; via: "gateway" | "direct"; answers: { [K in keyof Qs]: AnswerOf<Qs[K]> }; usage: { input_tokens: number; output_tokens: number } };

export const typesafeKey = () => (process.env.TYPESAFE_API_KEY ?? "").trim() || null;
export const gatewayKey = () => (process.env.AI_GATEWAY_API_KEY ?? "").trim() || null;
/** Na Vercel o gateway aceita o token OIDC do deploy mesmo sem chave. */
export const gatewayAvailable = () => !!gatewayKey() || !!process.env.VERCEL_OIDC_TOKEN;
export const jevAvailable = () => gatewayAvailable() || !!typesafeKey();

/** Confiança de uma distribuição, como a TypeSafe define: 1 quando tudo está numa opção, 0 quando espalha. */
function confidenceOf(probabilities: Record<string, number> | undefined): number {
  const ps = Object.values(probabilities ?? {}).filter((p) => p > 0);
  if (ps.length <= 1) return 1;
  const entropy = -ps.reduce((s, p) => s + p * Math.log(p), 0);
  return Math.round((1 - entropy / Math.log(ps.length)) * 100) / 100;
}

/** Pelo gateway: mesmas perguntas, com o "noul" traduzido para "boolean", que é o nome do SDK. */
async function viaGateway<Qs extends Readonly<Record<string, Question>>>(state: unknown, questions: Qs): Promise<SystemOneResult<Qs> | null> {
  const asSdk = Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.type === "noul" ? { type: "boolean" as const, instructions: q.instructions as string, criteria: q.criteria } : q]));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await evaluate({ model: GATEWAY_MODEL, state: state as never, questions: asSdk as never, maxRetries: 1, abortSignal: controller.signal });
    const meta = (r.providerMetadata as { typesafe?: { confidence?: Record<string, number> } } | undefined)?.typesafe?.confidence ?? {};
    const answers = Object.fromEntries(
      Object.entries(r.answers as Record<string, { type: string; probability?: number; score?: number; choice?: string; probabilities?: Record<string, number> }>).map(([id, a]) => {
        if (a.type === "boolean") return [id, { type: "noul", noul: a.probability ?? 0 }];
        if (a.type === "score") return [id, { type: "score", score: a.score ?? 0, probabilities: a.probabilities ?? {}, confidence: meta[id] ?? confidenceOf(a.probabilities) }];
        return [id, { type: "choice", choice: a.choice ?? "", probabilities: a.probabilities ?? {}, confidence: meta[id] ?? confidenceOf(a.probabilities) }];
      }),
    );
    return { model: r.response.modelId, via: "gateway", answers: answers as SystemOneResult<Qs>["answers"], usage: { input_tokens: r.usage.inputTokens ?? 0, output_tokens: r.usage.outputTokens ?? 0 } };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pela API direta da TypeSafe. */
async function viaDirect<Qs extends Readonly<Record<string, Question>>>(state: unknown, questions: Qs): Promise<SystemOneResult<Qs> | null> {
  const key = typesafeKey();
  if (!key) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(DIRECT_ENDPOINT, { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state, questions }) });
      if (res.ok) return { ...((await res.json()) as Omit<SystemOneResult<Qs>, "via">), via: "direct" };
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

/** Nulo = sem credencial, ou nenhum dos caminhos respondeu: nunca derruba quem chama. */
export async function systemOne<const Qs extends Readonly<Record<string, Question>>>(state: unknown, questions: Qs): Promise<SystemOneResult<Qs> | null> {
  if (gatewayAvailable()) {
    const r = await viaGateway(state, questions);
    if (r) return r;
  }
  return viaDirect(state, questions);
}
