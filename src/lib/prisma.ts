import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  try {
    return new PrismaClient({ log: ["error"] });
  } catch {
    return {} as PrismaClient;
  }
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Retry a DB op on transient Neon connectivity errors (P1001 "Can't reach
 * database server", connection terminated/reset). On serverless the Neon compute
 * can be suspended/cold; the first hit fails but a quick retry warms it up. Use
 * around critical writes (e.g. persisting a published/scheduled post) so a cold
 * start doesn't lose the action.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // P2028 / "Transaction already closed" is the interactive-transaction
      // flavour of the same cold-start stall: only withSeeded uses transactions,
      // and its body is idempotent, so replaying it is safe.
      const transient =
        /P1001|P1017|P2028|Can't reach database server|Connection (terminated|reset|closed)|ECONNRESET|ETIMEDOUT|server has closed the connection|Timed out fetching a new connection|Transaction (already closed|not found|API error)/i.test(
          msg,
        );
      if (!transient || i === tries - 1) throw err;
      lastErr = err;
      // 0.3s, 0.9s, 1.5s … gives Neon time to wake from suspend.
      await new Promise((r) => setTimeout(r, 300 + i * 600));
    }
  }
  throw lastErr;
}
