import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { systemOne, typesafeKey } from "@/lib/typesafe";

// O gerador de posts tem regras no prompt ("não invente prêmio, número, data"),
// mas nada conferia o texto que SAIU. Aqui confere: o rascunho é julgado contra
// o briefing da campanha, e o resultado fica gravado no documento.
//
// São julgamentos pequenos e separados, cada um com a sua probabilidade; o
// limiar e o veredito são nossos, em código. Só vai para fora o briefing e o
// rascunho — texto feito para ser publicado.

export type DraftFlag = "number" | "date" | "reward" | "hype";
export type DraftCheck = {
  verdict: "ok" | "review";
  flags: DraftFlag[];
  /** Probabilidade de cada invenção (0–1) e o hype numa escala de 0 a 2. */
  scores: { number: number; date: number; reward: number; hype: number };
  model: string;
  checkedAt: string;
  /** Do texto conferido: se o documento mudou depois, a checagem está velha. */
  contentHash: string;
};

/** Rascunho curto é o que se confere: tweet, cast, post. Texto longo tem número de sobra e custa caro. */
export const MAX_CHECK_CHARS = 1_800;
const INVENTS = 0.5;
const HYPE = 1.3;

export const hashOf = (text: string) => crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
export const draftCheckEnabled = () => !!typesafeKey();

const QUESTIONS = {
  number: { type: "noul", instructions: "Does `draft` state a specific number, amount, percentage or statistic that does NOT appear in `brief`?", criteria: { true: "The draft contains a concrete figure that the brief never mentions", false: "Every figure in the draft is in the brief, or the draft has no figures" } },
  date: { type: "noul", instructions: "Does `draft` announce a specific date, deadline or time window that does NOT appear in `brief`?", criteria: { true: "A date or deadline that the brief never mentions", false: "No dates, or only dates the brief mentions" } },
  reward: { type: "noul", instructions: "Does `draft` promise a prize, giveaway, airdrop, guaranteed return or payout that does NOT appear in `brief`?", criteria: { true: "A reward or return the brief never mentions", false: "No such promise, or one the brief supports" } },
  hype: { type: "score", instructions: "How much does `draft` read like generic crypto hype rather than a specific description of what the product does?", criteria: ["Plain and specific: describes what the feature does", "Some promotional language, still specific", "Mostly hype: urgency, emojis, hashtags, vague promises"] },
} as const;

/** Nulo = não conferiu (sem chave, sem briefing, texto longo demais ou API fora): não é um "ok". */
export async function checkDraft(brief: string, draft: string): Promise<DraftCheck | null> {
  const text = draft.trim();
  if (!brief.trim() || text.length < 12 || text.length > MAX_CHECK_CHARS) return null;
  const res = await systemOne({ brief: brief.trim().slice(0, 12_000), draft: text }, QUESTIONS);
  if (!res) return null;
  const a = res.answers;
  const scores = { number: a.number.noul, date: a.date.noul, reward: a.reward.noul, hype: a.hype.score };
  const flags: DraftFlag[] = [];
  if (scores.number > INVENTS) flags.push("number");
  if (scores.date > INVENTS) flags.push("date");
  if (scores.reward > INVENTS) flags.push("reward");
  if (scores.hype > HYPE) flags.push("hype");
  const round = (n: number) => Math.round(n * 100) / 100;
  return { verdict: flags.length ? "review" : "ok", flags, scores: { number: round(scores.number), date: round(scores.date), reward: round(scores.reward), hype: round(scores.hype) }, model: res.model, checkedAt: new Date().toISOString(), contentHash: hashOf(text) };
}

/** Confere um documento contra o briefing da campanha dele e grava o resultado. */
export async function checkAndStore(documentId: string, briefHint?: string): Promise<DraftCheck | null> {
  const doc = await prisma.campaignDocument.findUnique({ where: { id: documentId }, select: { id: true, content: true, isMain: true, campaignId: true } });
  if (!doc || doc.isMain) return null;
  const brief = briefHint ?? (await prisma.campaignDocument.findFirst({ where: { campaignId: doc.campaignId, isMain: true }, select: { content: true } }))?.content ?? "";
  const check = await checkDraft(brief, doc.content);
  if (!check) return null;
  // Por SQL, de propósito: conferir não é editar. Um update do Prisma mexeria no
  // updatedAt, o documento viraria "atualizado agora" e subiria na lista.
  await prisma.$executeRaw`UPDATE "CampaignDocument" SET "check" = ${JSON.stringify(check)}::jsonb WHERE "id" = ${doc.id}`;
  return check;
}
