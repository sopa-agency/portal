import "server-only";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Sonda de cota da Zerion.
//
// Por que ela existe: a ZERION_API_KEY está na Vercel como write-only — nem o
// CLI nem o painel devolvem o valor. Ninguém consegue rodar um curl com ela de
// fora. E os logs da Vercel não são legíveis por API a partir daqui. Então o
// único caminho para descobrir a cota é: chamar de DENTRO do runtime (que tem a
// chave) e PERSISTIR o resultado onde o portal já sabe ler — o Postgres.
//
// Chama `/v1/chains/`, que é estático e NÃO consome cota de carteira. O que
// interessa são os headers de rate limit, não o corpo.
//
// A chave nunca é impressa, logada, nem gravada. Só os headers, que não contêm
// segredo. Auth é Basic com a chave como usuário e senha vazia.
// ---------------------------------------------------------------------------

/** Headers que valem guardar. Lista fechada: nunca gravamos header arbitrário,
 *  porque um provedor pode ecoar credencial num header inesperado. */
const INTERESSE = [
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
  "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset",
  "retry-after", "x-quota-limit", "x-quota-remaining", "x-plan", "x-request-id",
];

export type ZerionProbeResult = { ok: boolean; status?: number; headers?: Record<string,string>; error?: string };

/** Nunca lança: roda dentro do cron e não pode derrubar o resto do tick. */
export async function probeZerionQuota(): Promise<ZerionProbeResult> {
  const key = process.env.ZERION_API_KEY?.trim();
  if (!key) {
    const error = "ZERION_API_KEY não está definida — sonda não tem o que medir.";
    await save({ ok: false, error });
    return { ok: false, error };
  }

  const auth = Buffer.from(`${key}:`).toString("base64");
  try {
    const res = await fetch("https://api.zerion.io/v1/chains/", {
      headers: { authorization: `Basic ${auth}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const headers: Record<string, string> = {};
    for (const h of INTERESSE) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    // Sem header de cota o provedor não expõe o limite — registrar isso é tão
    // útil quanto registrar o número, e evita alguém procurar de novo amanhã.
    if (Object.keys(headers).length === 0) headers["_nota"] = "nenhum header de rate limit na resposta";
    const out = { ok: res.ok, status: res.status, headers };
    await save(out);
    return out;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await save({ ok: false, error });
    return { ok: false, error };
  }
}

/** Uma linha só, sobrescrita a cada tick. Falha ao gravar não derruba a sonda. */
async function save(r: ZerionProbeResult): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ZerionProbe" (id, "checkedAt", status, ok, headers, error)
       VALUES ('singleton', now(), $1, $2, $3::jsonb, $4)
       ON CONFLICT (id) DO UPDATE SET
         "checkedAt" = now(), status = $1, ok = $2, headers = $3::jsonb, error = $4`,
      r.status ?? null, r.ok, JSON.stringify(r.headers ?? {}), r.error ?? null,
    );
  } catch (e) {
    console.error("[zerion-probe] não consegui gravar o resultado:", e instanceof Error ? e.message : e);
  }
}
