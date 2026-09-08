// Audience segments for controlled outreach — shared by the server resolver
// (src/lib/outreach.ts, server-only) and the client panel, so it carries no
// server imports. Segment definitions and the measurements behind them live
// next to the resolver.

export const INACTIVE_CUTOFF_DAYS = 90;

export type OutreachAudienceMode =
  /** Has a Hive account, posted at least once, nothing for INACTIVE_CUTOFF_DAYS+ — the win-back target. */
  | "lapsed"
  /** Has a Hive account and never posted or commented. */
  | "never_posted"
  /** Handle reserved in the userbase but no Hive account behind it (onboarding never finished). */
  | "no_hive"
  /** Every opted-in subscriber, no activity filter. */
  | "all_subscribed";

export const OUTREACH_MODE_LABELS: Record<OutreachAudienceMode, string> = {
  lapsed: `Sumiram (postaram, parados ${INACTIVE_CUTOFF_DAYS}d+)`,
  never_posted: "Nunca postaram (têm conta Hive)",
  no_hive: "Sem conta Hive (cadastro incompleto)",
  all_subscribed: "Todos os inscritos",
};

/**
 * Controlled outreach (and the fixed win-back email that rides on it) exists
 * only on the tenant that owns the shared userbase — same gate as the
 * userbase actions.
 */
export function outreachAvailable(project: { agent: { gatewayEnvPrefix: string } }): boolean {
  return project.agent.gatewayEnvPrefix === "SKATEHIVE";
}
